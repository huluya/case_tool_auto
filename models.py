from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()


class Project(db.Model):
    __tablename__ = 'projects'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(255), nullable=False, unique=True)
    description = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    versions = db.relationship('Version', backref='project', lazy=True, cascade='all, delete-orphan')
    columns = db.relationship('CustomColumn', backref='project', lazy=True, cascade='all, delete-orphan')
    cases = db.relationship('TestCase', backref='project', lazy=True, cascade='all, delete-orphan')
    merges = db.relationship('CaseMerge', backref='project', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S') if self.updated_at else None,
        }


class Version(db.Model):
    __tablename__ = 'versions'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id'), nullable=False)
    version_name = db.Column(db.String(100), nullable=False, default='默认版本')
    sort_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.now)

    cases = db.relationship('TestCase', backref='version', lazy=True, cascade='all, delete-orphan')
    merges = db.relationship('CaseMerge', backref='version', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'version_name': self.version_name,
            'sort_order': self.sort_order,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
        }


class CustomColumn(db.Model):
    __tablename__ = 'custom_columns'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)       # 显示名称
    key = db.Column(db.String(100), nullable=False)         # 字段标识
    is_system = db.Column(db.Boolean, default=False)        # 是否系统预设列
    is_visible = db.Column(db.Boolean, default=True)        # 是否显示
    width = db.Column(db.Integer, default=120)              # 列宽 px
    sort_order = db.Column(db.Integer, default=0)           # 排序
    created_at = db.Column(db.DateTime, default=datetime.now)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'name': self.name,
            'key': self.key,
            'is_system': self.is_system,
            'is_visible': self.is_visible,
            'width': self.width,
            'sort_order': self.sort_order,
        }


class TestCase(db.Model):
    __tablename__ = 'test_cases'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id'), nullable=False)
    version_id = db.Column(db.Integer, db.ForeignKey('versions.id'), nullable=False)
    case_no = db.Column(db.String(100), nullable=False, default='')
    module = db.Column(db.Text, default='')
    title = db.Column(db.Text, default='')
    precondition = db.Column(db.Text, default='')
    steps = db.Column(db.Text, default='')
    expected_result = db.Column(db.Text, default='')
    priority = db.Column(db.String(50), default='')
    status = db.Column(db.String(50), default='未执行')      # 通过/失败/未执行/阻塞/跳过
    remark = db.Column(db.Text, default='')
    custom_fields = db.Column(db.Text, default='{}')         # JSON 存储自定义列数据
    sort_order = db.Column(db.Integer, default=0)            # 行排序
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    images = db.relationship('CaseImage', backref='case', lazy=True, cascade='all, delete-orphan')

    def get_custom_fields(self):
        try:
            return json.loads(self.custom_fields or '{}')
        except Exception:
            return {}

    def set_custom_fields(self, fields):
        self.custom_fields = json.dumps(fields, ensure_ascii=False)

    def to_dict(self, columns=None):
        data = {
            'id': self.id,
            'project_id': self.project_id,
            'version_id': self.version_id,
            'case_no': self.case_no,
            'module': self.module,
            'title': self.title,
            'precondition': self.precondition,
            'steps': self.steps,
            'expected_result': self.expected_result,
            'priority': self.priority,
            'status': self.status,
            'remark': self.remark,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S') if self.updated_at else None,
        }
        custom = self.get_custom_fields()
        data['custom_fields'] = custom
        # 列表页需要直接拿到用例附件，才能在对应行展示缩略图。
        data['images'] = [image.to_dict() for image in self.images]
        if columns:
            for col in columns:
                if not col['is_system'] and col['key'] not in data:
                    data[col['key']] = custom.get(col['key'], '')
        return data


class CaseMerge(db.Model):
    """保存表格中的合并单元格范围（当前支持同一列的连续行合并）。"""
    __tablename__ = 'case_merges'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id'), nullable=False)
    version_id = db.Column(db.Integer, db.ForeignKey('versions.id'), nullable=False)
    column_key = db.Column(db.String(100), nullable=False)
    case_ids = db.Column(db.Text, nullable=False, default='[]')
    created_at = db.Column(db.DateTime, default=datetime.now)

    def get_case_ids(self):
        try:
            values = json.loads(self.case_ids or '[]')
            return [int(value) for value in values]
        except (TypeError, ValueError, json.JSONDecodeError):
            return []

    def set_case_ids(self, case_ids):
        self.case_ids = json.dumps([int(case_id) for case_id in case_ids])

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'version_id': self.version_id,
            'column_key': self.column_key,
            'case_ids': self.get_case_ids(),
        }


class CaseImage(db.Model):
    __tablename__ = 'case_images'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    test_case_id = db.Column(db.Integer, db.ForeignKey('test_cases.id'), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

    def to_dict(self):
        return {
            'id': self.id,
            'test_case_id': self.test_case_id,
            'filename': self.filename,
            'file_path': self.file_path.replace('\\', '/'),
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
        }


# 系统预设列定义
SYSTEM_COLUMNS = [
    {'key': 'case_no', 'name': '用例序号', 'width': 120, 'is_system': True},
    {'key': 'module', 'name': '模块', 'width': 120, 'is_system': True},
    {'key': 'title', 'name': '标题', 'width': 200, 'is_system': True},
    {'key': 'precondition', 'name': '前置条件', 'width': 220, 'is_system': True},
    {'key': 'steps', 'name': '步骤', 'width': 250, 'is_system': True},
    {'key': 'expected_result', 'name': '预期结果', 'width': 220, 'is_system': True},
    {'key': 'priority', 'name': '优先级', 'width': 100, 'is_system': True},
    {'key': 'status', 'name': '执行结果', 'width': 120, 'is_system': True},
    {'key': 'remark', 'name': '备注', 'width': 200, 'is_system': True},
]

STATUS_LIST = ['通过', '失败', '未执行', '阻塞', '跳过']
