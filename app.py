import os
import io
import json
import html
import shutil
import subprocess
import uuid
import re
import posixpath
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from datetime import datetime

from flask import Flask, request, jsonify, send_from_directory, render_template
from sqlalchemy import create_engine, text
from werkzeug.utils import secure_filename
import openpyxl
from openpyxl.worksheet.cell_range import CellRange

import config
from models import db, Project, Version, CustomColumn, TestCase, CaseImage, CaseMerge, SYSTEM_COLUMNS, STATUS_LIST

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = config.SQLALCHEMY_DATABASE_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

db.init_app(app)


def create_database():
    """如果数据库不存在则创建"""
    engine = create_engine(
        f"mysql+pymysql://{config.DB_USER}:{config.DB_PASSWORD}@{config.DB_HOST}:{config.DB_PORT}",
        isolation_level="AUTOCOMMIT"
    )
    with engine.connect() as conn:
        conn.execute(text(f"CREATE DATABASE IF NOT EXISTS {config.DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))


def init_system_columns(project_id):
    """初始化系统列，并将历史导入的同名自定义列迁移为系统列。"""
    for idx, col in enumerate(SYSTEM_COLUMNS):
        exists = CustomColumn.query.filter_by(project_id=project_id, key=col['key']).first()
        if not exists:
            legacy = CustomColumn.query.filter_by(
                project_id=project_id, name=col['name'], is_system=False
            ).first()
            if legacy:
                for case in TestCase.query.filter_by(project_id=project_id).all():
                    custom = case.get_custom_fields()
                    if legacy.key in custom:
                        setattr(case, col['key'], custom.pop(legacy.key))
                        case.set_custom_fields(custom)
                legacy.name = col['name']
                legacy.key = col['key']
                legacy.is_system = True
                legacy.width = col['width']
                legacy.sort_order = idx
            else:
                c = CustomColumn(
                    project_id=project_id,
                    name=col['name'],
                    key=col['key'],
                    is_system=col['is_system'],
                    is_visible=True,
                    width=col['width'],
                    sort_order=idx
                )
                db.session.add(c)
    db.session.commit()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = data.get('password', '')
    if username in config.USERS and config.USERS[username] == password:
        return jsonify({
            'success': True,
            'data': {
                'username': username,
                'role': 'admin' if username == 'admin' else 'test'
            }
        })
    return jsonify({'success': False, 'message': '账号或密码错误'}), 401


# ------------------- 项目 -------------------
@app.route('/api/projects', methods=['GET'])
def get_projects():
    projects = Project.query.order_by(Project.created_at.desc()).all()
    return jsonify({'success': True, 'data': [p.to_dict() for p in projects]})


@app.route('/api/projects', methods=['POST'])
def create_project():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': '项目名称不能为空'}), 400
    if Project.query.filter_by(name=name).first():
        return jsonify({'success': False, 'message': '项目名称已存在'}), 400

    project = Project(name=name, description=data.get('description', ''))
    db.session.add(project)
    db.session.flush()

    init_system_columns(project.id)
    db.session.commit()

    return jsonify({'success': True, 'data': project.to_dict()})


@app.route('/api/projects/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    project = Project.query.get_or_404(project_id)
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if name and name != project.name:
        if Project.query.filter_by(name=name).first():
            return jsonify({'success': False, 'message': '项目名称已存在'}), 400
        project.name = name
    project.description = data.get('description', project.description)
    db.session.commit()
    return jsonify({'success': True, 'data': project.to_dict()})


@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    data = request.json or {}
    if data.get('password') != config.DELETE_PASSWORD:
        return jsonify({'success': False, 'message': '删除密码错误'}), 403

    project = Project.query.get_or_404(project_id)
    # 删除关联图片文件
    for case in project.cases:
        for img in case.images:
            try:
                if os.path.exists(img.file_path):
                    os.remove(img.file_path)
            except Exception:
                pass
    db.session.delete(project)
    db.session.commit()
    return jsonify({'success': True})


# ------------------- 版本 -------------------
@app.route('/api/projects/<int:project_id>/versions', methods=['GET'])
def get_versions(project_id):
    versions = Version.query.filter_by(project_id=project_id).order_by(Version.sort_order.asc(), Version.id.asc()).all()
    return jsonify({'success': True, 'data': [v.to_dict() for v in versions]})


@app.route('/api/projects/<int:project_id>/versions', methods=['POST'])
def create_version(project_id):
    data = request.json or {}
    name = (data.get('version_name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': '版本名称不能为空'}), 400
    if Version.query.filter_by(project_id=project_id, version_name=name).first():
        return jsonify({'success': False, 'message': '该项目下版本名已存在'}), 400
    max_order = db.session.query(db.func.max(Version.sort_order)).filter_by(project_id=project_id).scalar()
    version = Version(project_id=project_id, version_name=name, sort_order=(max_order if max_order is not None else -1) + 1)
    db.session.add(version)
    db.session.commit()
    return jsonify({'success': True, 'data': version.to_dict()})


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/copy', methods=['POST'])
def copy_version(project_id, version_id):
    source = Version.query.filter_by(id=version_id, project_id=project_id).first_or_404()
    data = request.json or {}
    name = (data.get('version_name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': '副本名称不能为空'}), 400
    if Version.query.filter_by(project_id=project_id, version_name=name).first():
        return jsonify({'success': False, 'message': '该项目下版本名已存在'}), 400

    max_order = db.session.query(db.func.max(Version.sort_order)).filter_by(project_id=project_id).scalar()
    new_version = Version(
        project_id=project_id,
        version_name=name,
        sort_order=(max_order if max_order is not None else -1) + 1
    )
    copied_files = []
    try:
        db.session.add(new_version)
        db.session.flush()
        source_cases = TestCase.query.filter_by(project_id=project_id, version_id=source.id) \
            .order_by(TestCase.sort_order.asc(), TestCase.id.asc()).all()
        case_id_map = {}
        image_replacements = []
        for source_case in source_cases:
            copied_case = TestCase(
                project_id=project_id,
                version_id=new_version.id,
                case_no=source_case.case_no,
                module=source_case.module,
                title=source_case.title,
                precondition=source_case.precondition,
                steps=source_case.steps,
                expected_result=source_case.expected_result,
                priority=source_case.priority,
                status=source_case.status,
                remark=source_case.remark,
                custom_fields=source_case.custom_fields,
                sort_order=source_case.sort_order,
            )
            db.session.add(copied_case)
            db.session.flush()
            case_id_map[source_case.id] = copied_case.id

            for source_image in source_case.images:
                if not os.path.exists(source_image.file_path):
                    continue
                extension = os.path.splitext(source_image.file_path)[1].lower()
                filename = f'{uuid.uuid4().hex}{extension}'
                folder = os.path.join(config.UPLOAD_DIR, str(copied_case.id))
                os.makedirs(folder, exist_ok=True)
                target_path = os.path.join(folder, filename)
                shutil.copy2(source_image.file_path, target_path)
                copied_files.append(target_path)
                copied_image = CaseImage(
                    test_case_id=copied_case.id,
                    filename=source_image.filename,
                    file_path=target_path,
                )
                db.session.add(copied_image)
                image_replacements.append((copied_case, source_image, copied_image, filename))

        db.session.flush()
        for copied_case, source_image, copied_image, filename in image_replacements:
            old_relative = os.path.relpath(source_image.file_path, config.UPLOAD_DIR).replace(os.sep, '/')
            new_src = f'/uploads/{copied_case.id}/{filename}'
            tag_pattern = re.compile(r'<img\b[^>]*>', re.IGNORECASE)

            def replace_image_tag(match, old_id=source_image.id, old_path=f'/uploads/{old_relative}', new_id=copied_image.id, src=new_src):
                tag = match.group(0)
                has_id = re.search(r'data-image-id\s*=\s*["\']' + str(old_id) + r'["\']', tag, re.IGNORECASE)
                if not has_id and old_path not in tag:
                    return tag
                if not has_id:
                    tag = re.sub(r'(<img\b)', r'\1 data-image-id="' + str(new_id) + r'"', tag, count=1, flags=re.IGNORECASE)
                tag = re.sub(
                    r'(data-image-id\s*=\s*["\'])\d+(["\'])',
                    lambda m: m.group(1) + str(new_id) + m.group(2), tag, flags=re.IGNORECASE
                )
                tag = re.sub(
                    r'(src\s*=\s*["\'])[^"\']*(["\'])',
                    lambda m: m.group(1) + src + m.group(2), tag, flags=re.IGNORECASE
                )
                return tag

            copied_case.remark = tag_pattern.sub(replace_image_tag, copied_case.remark or '')

        for source_merge in CaseMerge.query.filter_by(project_id=project_id, version_id=source.id).all():
            copied_ids = [case_id_map[case_id] for case_id in source_merge.get_case_ids() if case_id in case_id_map]
            if len(copied_ids) >= 2:
                copied_merge = CaseMerge(
                    project_id=project_id,
                    version_id=new_version.id,
                    column_key=source_merge.column_key,
                )
                copied_merge.set_case_ids(copied_ids)
                db.session.add(copied_merge)

        db.session.commit()
        return jsonify({'success': True, 'data': {'version': new_version.to_dict(), 'copied_cases': len(source_cases)}})
    except Exception as exc:
        db.session.rollback()
        for filepath in copied_files:
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception:
                pass
        return jsonify({'success': False, 'message': f'创建版本副本失败: {str(exc)}'}), 500


@app.route('/api/projects/<int:project_id>/versions/order', methods=['POST'])
def update_version_order(project_id):
    data = request.json or {}
    orders = data.get('orders') or {}
    if not isinstance(orders, dict):
        return jsonify({'success': False, 'message': '版本排序数据格式错误'}), 400

    versions = Version.query.filter_by(project_id=project_id).all()
    version_map = {str(version.id): version for version in versions}
    try:
        requested = []
        for version_id, order in orders.items():
            version = version_map.get(str(version_id))
            if version is not None:
                requested.append((int(order), version.id, version))
        requested.sort(key=lambda item: (item[0], item[1]))
        ordered_ids = {item[1] for item in requested}
        remaining = sorted((version for version in versions if version.id not in ordered_ids),
                           key=lambda version: (version.sort_order or 0, version.id))
        for index, (_, _, version) in enumerate(requested):
            version.sort_order = index
        for index, version in enumerate(remaining, start=len(requested)):
            version.sort_order = index
        db.session.commit()
    except (TypeError, ValueError):
        db.session.rollback()
        return jsonify({'success': False, 'message': '版本排序值无效'}), 400
    return jsonify({'success': True, 'data': [v.to_dict() for v in sorted(versions, key=lambda v: (v.sort_order, v.id))]})


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>', methods=['PUT'])
def update_version(project_id, version_id):
    version = Version.query.filter_by(id=version_id, project_id=project_id).first_or_404()
    data = request.json or {}
    name = (data.get('version_name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': '版本名称不能为空'}), 400
    if Version.query.filter(
        Version.project_id == project_id,
        Version.version_name == name,
        Version.id != version_id,
    ).first():
        return jsonify({'success': False, 'message': '该项目下版本名已存在'}), 400
    version.version_name = name
    db.session.commit()
    return jsonify({'success': True, 'data': version.to_dict()})


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>', methods=['DELETE'])
def delete_version(project_id, version_id):
    data = request.json or {}
    if data.get('password') != config.DELETE_PASSWORD:
        return jsonify({'success': False, 'message': '删除密码错误'}), 403

    version = Version.query.filter_by(id=version_id, project_id=project_id).first_or_404()
    # 删除关联图片文件
    for case in version.cases:
        for img in case.images:
            try:
                if os.path.exists(img.file_path):
                    os.remove(img.file_path)
            except Exception:
                pass
    db.session.delete(version)
    db.session.commit()
    return jsonify({'success': True})


# ------------------- 自定义列 -------------------
@app.route('/api/projects/<int:project_id>/columns', methods=['GET'])
def get_columns(project_id):
    init_system_columns(project_id)
    columns = CustomColumn.query.filter_by(project_id=project_id).order_by(CustomColumn.sort_order).all()
    return jsonify({'success': True, 'data': [c.to_dict() for c in columns]})


@app.route('/api/projects/<int:project_id>/columns', methods=['POST'])
def add_column(project_id):
    data = request.json or {}
    name = (data.get('name') or '').strip()
    key = (data.get('key') or '').strip()
    if not name or not key:
        return jsonify({'success': False, 'message': '列名和字段标识不能为空'}), 400
    if not key.isidentifier():
        return jsonify({'success': False, 'message': '字段标识需为合法标识符'}), 400
    if CustomColumn.query.filter_by(project_id=project_id, key=key).first():
        return jsonify({'success': False, 'message': '字段标识已存在'}), 400

    max_order = db.session.query(db.func.max(CustomColumn.sort_order)).filter_by(project_id=project_id).scalar() or 0
    col = CustomColumn(
        project_id=project_id,
        name=name,
        key=key,
        is_system=False,
        is_visible=True,
        width=int(data.get('width', 150)),
        sort_order=max_order + 1
    )
    db.session.add(col)
    db.session.commit()
    return jsonify({'success': True, 'data': col.to_dict()})


@app.route('/api/columns/<int:column_id>', methods=['PUT'])
def update_column(column_id):
    col = CustomColumn.query.get_or_404(column_id)
    data = request.json or {}
    convert_to_system = (data.get('convert_to_system') or '').strip()
    system_def = next((item for item in SYSTEM_COLUMNS if item['key'] == convert_to_system), None)
    if convert_to_system:
        if col.is_system:
            return jsonify({'success': False, 'message': '系统列无需转换'}), 400
        if not system_def:
            return jsonify({'success': False, 'message': '目标系统列不存在'}), 400
        target = CustomColumn.query.filter_by(
            project_id=col.project_id, key=convert_to_system, is_system=True
        ).first()
        if not target:
            target = CustomColumn(
                project_id=col.project_id,
                name=system_def['name'],
                key=system_def['key'],
                is_system=True,
                is_visible=col.is_visible,
                width=system_def['width'],
                sort_order=col.sort_order,
            )
            db.session.add(target)
            db.session.flush()
        for case in TestCase.query.filter_by(project_id=col.project_id).all():
            custom = case.get_custom_fields()
            if col.key in custom:
                setattr(case, convert_to_system, custom[col.key])
                custom.pop(col.key, None)
                case.set_custom_fields(custom)
        db.session.delete(col)
        db.session.commit()
        return jsonify({'success': True, 'data': target.to_dict()})
    if 'name' in data:
        col.name = data['name'].strip()
    if 'is_visible' in data:
        col.is_visible = bool(data['is_visible'])
    if 'width' in data:
        col.width = int(data['width'])
    if 'sort_order' in data:
        col.sort_order = int(data['sort_order'])
    db.session.commit()
    return jsonify({'success': True, 'data': col.to_dict()})


@app.route('/api/columns/<int:column_id>', methods=['DELETE'])
def delete_column(column_id):
    col = CustomColumn.query.get_or_404(column_id)
    if col.is_system and col.key == 'status':
        return jsonify({'success': False, 'message': '执行结果列为固定列，不可删除'}), 400
    db.session.delete(col)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/projects/<int:project_id>/columns/order', methods=['POST'])
def update_columns_order(project_id):
    data = request.json or {}
    orders = data.get('orders', {})
    for col_id, order in orders.items():
        col = CustomColumn.query.filter_by(id=col_id, project_id=project_id).first()
        if col:
            col.sort_order = int(order)
    db.session.commit()
    return jsonify({'success': True})


# ------------------- 合并单元格 -------------------
@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/merges', methods=['POST'])
def create_merge(project_id, version_id):
    data = request.json or {}
    column_key = (data.get('column_key') or '').strip()
    case_ids = data.get('case_ids') or []
    version = Version.query.filter_by(id=version_id, project_id=project_id).first_or_404()
    column = CustomColumn.query.filter_by(project_id=project_id, key=column_key).first()
    if not column:
        return jsonify({'success': False, 'message': '列不存在'}), 400
    try:
        case_ids = list(dict.fromkeys(int(case_id) for case_id in case_ids))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': '合并范围无效'}), 400
    if len(case_ids) < 2:
        return jsonify({'success': False, 'message': '至少选择同一列的两个连续单元格'}), 400

    cases = TestCase.query.filter(
        TestCase.project_id == project_id,
        TestCase.version_id == version.id,
        TestCase.id.in_(case_ids)
    ).order_by(TestCase.sort_order.asc(), TestCase.id.asc()).all()
    if len(cases) != len(case_ids):
        return jsonify({'success': False, 'message': '合并单元格必须来自当前版本'}), 400
    all_cases = TestCase.query.filter_by(project_id=project_id, version_id=version_id) \
        .order_by(TestCase.sort_order.asc(), TestCase.id.asc()).all()
    positions = [all_cases.index(case) for case in cases]
    if positions != list(range(min(positions), max(positions) + 1)):
        return jsonify({'success': False, 'message': '只能合并同一列的连续单元格'}), 400

    for merge in CaseMerge.query.filter_by(project_id=project_id, version_id=version_id, column_key=column_key).all():
        if set(merge.get_case_ids()).intersection(case_ids):
            return jsonify({'success': False, 'message': '选中的单元格已经合并'}), 400

    merge = CaseMerge(project_id=project_id, version_id=version_id, column_key=column_key)
    merge.set_case_ids([case.id for case in cases])
    db.session.add(merge)
    db.session.commit()
    return jsonify({'success': True, 'data': merge.to_dict()})


@app.route('/api/merges/<int:merge_id>', methods=['DELETE'])
def delete_merge(merge_id):
    merge = CaseMerge.query.get_or_404(merge_id)
    db.session.delete(merge)
    db.session.commit()
    return jsonify({'success': True})


def compute_sort_orders(project_id, version_id, target_id=None, position=None, count=1):
    """根据插入目标计算新行的 sort_order 列表（递增）"""
    cases = TestCase.query.filter_by(project_id=project_id, version_id=version_id)\
        .order_by(TestCase.sort_order.asc(), TestCase.id.asc()).all()
    n = max(1, count)
    if not cases:
        return [1000 * (i + 1) for i in range(n)]

    if not target_id or position not in ('above', 'below'):
        # 默认在顶部插入
        base = cases[0].sort_order
        return [base - (n - i) * 1000 for i in range(n)]

    idx = next((i for i, c in enumerate(cases) if c.id == target_id), -1)
    if idx < 0:
        base = cases[-1].sort_order
        return [base + (i + 1) * 1000 for i in range(n)]

    if position == 'above':
        prev_order = cases[idx - 1].sort_order if idx > 0 else None
        next_order = cases[idx].sort_order
        if prev_order is None:
            step = 1000
            start = next_order - (n + 1) * 1000
        else:
            gap = next_order - prev_order
            step = max(1, gap // (n + 1))
            start = prev_order
    else:  # below
        prev_order = cases[idx].sort_order
        next_order = cases[idx + 1].sort_order if idx + 1 < len(cases) else None
        if next_order is None:
            step = 1000
            start = prev_order
        else:
            gap = next_order - prev_order
            step = max(1, gap // (n + 1))
            start = prev_order

    return [start + step * (i + 1) for i in range(n)]


# ------------------- 用例 -------------------
@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/cases', methods=['GET'])
def get_cases(project_id, version_id):
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 20, type=int)
    if page_size not in [20, 50, 100]:
        page_size = 20
    keyword = request.args.get('keyword', '')

    init_system_columns(project_id)
    query = TestCase.query.filter_by(project_id=project_id, version_id=version_id)
    if keyword:
        query = query.filter(
            db.or_(
                TestCase.title.contains(keyword),
                TestCase.case_no.contains(keyword),
                TestCase.module.contains(keyword)
            )
        )

    total = query.count()
    cases = query.order_by(TestCase.sort_order.asc(), TestCase.id.asc()).offset((page - 1) * page_size).limit(page_size).all()
    columns = CustomColumn.query.filter_by(project_id=project_id).order_by(CustomColumn.sort_order).all()
    columns_dict = [c.to_dict() for c in columns]
    merges = CaseMerge.query.filter_by(project_id=project_id, version_id=version_id).all()

    data = {
        'total': total,
        'page': page,
        'page_size': page_size,
        'columns': columns_dict,
        'cases': [c.to_dict(columns_dict) for c in cases],
        'merges': [merge.to_dict() for merge in merges]
    }
    return jsonify({'success': True, 'data': data})


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/cases/reset-numbers', methods=['POST'])
def reset_case_numbers(project_id, version_id):
    """按当前列表顺序将一个版本内的用例编号重排为 1..n。"""
    version = Version.query.filter_by(id=version_id, project_id=project_id).first()
    if not version:
        return jsonify({'success': False, 'message': '项目或版本不存在'}), 404

    cases = TestCase.query.filter_by(project_id=project_id, version_id=version_id) \
        .order_by(TestCase.sort_order.asc(), TestCase.id.asc()).all()
    for index, case in enumerate(cases, start=1):
        case.case_no = str(index)
    db.session.commit()
    return jsonify({'success': True, 'data': {'reset': len(cases)}})


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/reset-status', methods=['POST'])
def reset_case_status(project_id, version_id):
    """将一个版本内所有用例的执行结果重置为未执行。"""
    version = Version.query.filter_by(id=version_id, project_id=project_id).first()
    if not version:
        return jsonify({'success': False, 'message': '项目或版本不存在'}), 404
    cases = TestCase.query.filter_by(project_id=project_id, version_id=version_id).all()
    for case in cases:
        case.status = '未执行'
    db.session.commit()
    return jsonify({'success': True, 'data': {'reset': len(cases)}})


@app.route('/api/cases', methods=['POST'])
def create_case():
    data = request.json or {}
    project_id = data.get('project_id')
    version_id = data.get('version_id')
    if not project_id or not version_id:
        return jsonify({'success': False, 'message': '项目或版本缺失'}), 400

    case_no = excel_value_to_text(data.get('case_no'))
    if not case_no:
        case_no = str(next_case_number(project_id, version_id))

    case = TestCase(
        project_id=project_id,
        version_id=version_id,
        case_no=case_no,
        module=data.get('module', ''),
        title=data.get('title', ''),
        precondition=data.get('precondition', ''),
        steps=data.get('steps', ''),
        expected_result=data.get('expected_result', ''),
        priority=data.get('priority', ''),
        status=data.get('status', '未执行'),
        remark=data.get('remark', ''),
        sort_order=compute_sort_orders(project_id, version_id, count=1)[0]
    )
    if case.status not in STATUS_LIST:
        case.status = '未执行'

    custom = data.get('custom_fields', {})
    if not isinstance(custom, dict):
        custom = {}
    valid_keys = {c.key for c in CustomColumn.query.filter_by(project_id=project_id, is_system=False).all()}
    case.set_custom_fields({k: v for k, v in (custom or {}).items() if k in valid_keys})

    db.session.add(case)
    db.session.commit()
    columns = CustomColumn.query.filter_by(project_id=project_id).order_by(CustomColumn.sort_order).all()
    return jsonify({'success': True, 'data': case.to_dict([c.to_dict() for c in columns])})


@app.route('/api/cases/batch', methods=['POST'])
def create_cases_batch():
    data = request.json or {}
    project_id = data.get('project_id')
    version_id = data.get('version_id')
    cases_data = data.get('cases', [])
    if not project_id or not version_id:
        return jsonify({'success': False, 'message': '项目或版本缺失'}), 400
    if not cases_data:
        return jsonify({'success': False, 'message': '没有用例数据'}), 400

    target_id = data.get('insert_target')
    position = data.get('insert_position')  # 'above' 或 'below'
    valid_keys = {c.key for c in CustomColumn.query.filter_by(project_id=project_id, is_system=False).all()}
    sort_orders = compute_sort_orders(project_id, version_id, target_id, position, len(cases_data))
    next_number = next_case_number(project_id, version_id)

    created = []
    for i, item in enumerate(cases_data):
        item = item if isinstance(item, dict) else {}
        case_no = excel_value_to_text(item.get('case_no'))
        if not case_no:
            case_no = str(next_number)
            next_number += 1
        case = TestCase(
            project_id=project_id,
            version_id=version_id,
            case_no=case_no,
            module=item.get('module', ''),
            title=item.get('title', ''),
            precondition=item.get('precondition', ''),
            steps=item.get('steps', ''),
            expected_result=item.get('expected_result', ''),
            priority=item.get('priority', ''),
            status=item.get('status', '未执行'),
            remark=item.get('remark', ''),
            sort_order=sort_orders[i]
        )
        if case.status not in STATUS_LIST:
            case.status = '未执行'
        custom = item.get('custom_fields', {})
        if not isinstance(custom, dict):
            custom = {}
        case.set_custom_fields({k: v for k, v in (custom or {}).items() if k in valid_keys})
        db.session.add(case)
        created.append(case)

    db.session.flush()
    db.session.commit()
    columns = CustomColumn.query.filter_by(project_id=project_id).order_by(CustomColumn.sort_order).all()
    columns_dict = [c.to_dict() for c in columns]
    return jsonify({'success': True, 'data': [c.to_dict(columns_dict) for c in created]})


@app.route('/api/cases/<int:case_id>', methods=['PUT'])
def update_case(case_id):
    case = TestCase.query.get_or_404(case_id)
    data = request.json or {}
    if 'case_no' in data:
        case_no = excel_value_to_text(data.get('case_no'))
        case.case_no = case_no or str(next_case_number(case.project_id, case.version_id))
    case.module = data.get('module', case.module)
    case.title = data.get('title', case.title)
    case.precondition = data.get('precondition', case.precondition)
    case.steps = data.get('steps', case.steps)
    case.expected_result = data.get('expected_result', case.expected_result)
    case.priority = data.get('priority', case.priority)
    if 'status' in data and data['status'] in STATUS_LIST:
        case.status = data['status']
    case.remark = data.get('remark', case.remark)

    custom = data.get('custom_fields', {}) or {}
    if not isinstance(custom, dict):
        custom = {}
    with db.session.no_autoflush:
        valid_keys = {c.key for c in CustomColumn.query.filter_by(project_id=case.project_id, is_system=False).all()}
    merged = case.get_custom_fields()
    merged.update({k: v for k, v in custom.items() if k in valid_keys})
    case.set_custom_fields(merged)

    db.session.commit()
    columns = CustomColumn.query.filter_by(project_id=case.project_id).order_by(CustomColumn.sort_order).all()
    return jsonify({'success': True, 'data': case.to_dict([c.to_dict() for c in columns])})


@app.route('/api/cases/<int:case_id>', methods=['DELETE'])
def delete_case(case_id):
    case = TestCase.query.get_or_404(case_id)
    # 删除图片文件
    for img in case.images:
        try:
            if os.path.exists(img.file_path):
                os.remove(img.file_path)
        except Exception:
            pass
    for merge in CaseMerge.query.filter_by(project_id=case.project_id, version_id=case.version_id).all():
        remaining_ids = [value for value in merge.get_case_ids() if value != case.id]
        if len(remaining_ids) < 2:
            db.session.delete(merge)
        else:
            merge.set_case_ids(remaining_ids)
    db.session.delete(case)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/cases/batch-delete', methods=['POST'])
def delete_cases_batch():
    data = request.json or {}
    raw_ids = data.get('case_ids') or []
    if not isinstance(raw_ids, list):
        return jsonify({'success': False, 'message': '用例编号格式错误'}), 400
    try:
        case_ids = list(dict.fromkeys(int(case_id) for case_id in raw_ids))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': '用例编号格式错误'}), 400
    cases = TestCase.query.filter(TestCase.id.in_(case_ids)).all() if case_ids else []
    for case in cases:
        for img in case.images:
            try:
                if os.path.exists(img.file_path):
                    os.remove(img.file_path)
            except Exception:
                pass
        for merge in CaseMerge.query.filter_by(project_id=case.project_id, version_id=case.version_id).all():
            remaining_ids = [value for value in merge.get_case_ids() if value != case.id]
            if len(remaining_ids) < 2:
                db.session.delete(merge)
            else:
                merge.set_case_ids(remaining_ids)
        db.session.delete(case)
    db.session.commit()
    return jsonify({'success': True, 'data': {'deleted': len(cases)}})


# ------------------- 统计 -------------------
@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/stats', methods=['GET'])
def get_stats(project_id, version_id):
    total = TestCase.query.filter_by(project_id=project_id, version_id=version_id).count()
    stats = {}
    for status in STATUS_LIST:
        count = TestCase.query.filter_by(project_id=project_id, version_id=version_id, status=status).count()
        stats[status] = {
            'count': count,
            'percent': round(count / total * 100, 1) if total else 0
        }
    return jsonify({
        'success': True,
        'data': {
            'total': total,
            'stats': stats
        }
    })


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/summary', methods=['GET'])
def get_summary(project_id, version_id):
    total = TestCase.query.filter_by(project_id=project_id, version_id=version_id).count()
    counts = {}
    for status in STATUS_LIST:
        counts[status] = TestCase.query.filter_by(project_id=project_id, version_id=version_id, status=status).count()

    executed = total - counts['跳过'] - counts['阻塞']
    skip_cases = TestCase.query.filter_by(project_id=project_id, version_id=version_id, status='跳过').all()
    block_cases = TestCase.query.filter_by(project_id=project_id, version_id=version_id, status='阻塞').all()

    def reasons(cases):
        result = []
        for c in cases:
            remark = (c.remark or '').strip()
            if remark:
                result.append({'id': c.id, 'case_no': c.case_no, 'title': c.title, 'reason': remark})
        return result

    return jsonify({
        'success': True,
        'data': {
            'total': total,
            'executed': executed,
            'success': counts['通过'],
            'fail': counts['失败'],
            'block': counts['阻塞'],
            'skip': counts['跳过'],
            'unexecuted': counts['未执行'],
            'skip_reasons': reasons(skip_cases),
            'block_reasons': reasons(block_cases),
            'can_summarize': counts['未执行'] == 0 and total > 0
        }
    })


# ------------------- Excel 导入 -------------------
def _xml_local_name(tag):
    return tag.rsplit('}', 1)[-1]


def _xml_attr(element, name):
    for key, value in element.attrib.items():
        if _xml_local_name(key) == name:
            return value
    return None


def _active_worksheet_xml_path(archive):
    """返回工作簿当前活动工作表的 XML 路径。"""
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    sheets = [node for node in workbook.iter() if _xml_local_name(node.tag) == 'sheet']
    active_tab = 0
    for node in workbook.iter():
        if _xml_local_name(node.tag) == 'workbookView':
            try:
                active_tab = int(node.attrib.get('activeTab', 0))
            except (TypeError, ValueError):
                active_tab = 0
            break
    sheet = sheets[min(max(active_tab, 0), max(len(sheets) - 1, 0))]
    relation_id = _xml_attr(sheet, 'id')
    rels = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    target = None
    for relation in rels.iter():
        if relation.attrib.get('Id') == relation_id:
            target = relation.attrib.get('Target')
            break
    if not target:
        raise ValueError('无法定位 Excel 活动工作表')
    if target.startswith('/'):
        return target.lstrip('/')
    return posixpath.normpath(posixpath.join('xl', target))


def inspect_excel_bounds(file_storage):
    """快速扫描工作表 XML，只找真实有值的行和合并范围。

    某些 Excel 文件会把整张表写成带格式的空行/空列，openpyxl 的
    max_row/max_column 会因此膨胀。这里不读取单元格值，只扫描 XML 的
    有值节点，避免后续 iter_rows 遍历几十万空单元格。
    """
    stream = getattr(file_storage, 'stream', file_storage)
    stream.seek(0)
    try:
        with ZipFile(stream) as archive:
            sheet_path = _active_worksheet_xml_path(archive)
            last_value_row = 1
            merge_refs = []
            # 只按 XML 行块扫描，不让 openpyxl/ElementTree 为数万条格式空行
            # 创建对象。带值单元格一定包含 v、is 或 f 节点；只有样式的空行会被跳过。
            worksheet_bytes = archive.read(sheet_path)
            row_start = 0
            while True:
                row_start = worksheet_bytes.find(b'<row ', row_start)
                if row_start < 0:
                    break
                row_end = worksheet_bytes.find(b'</row>', row_start)
                if row_end < 0:
                    break
                row_number_start = worksheet_bytes.find(b' r="', row_start, row_end)
                if row_number_start >= 0:
                    row_number_start += 4
                    row_number_end = worksheet_bytes.find(b'"', row_number_start, row_end)
                    row_number = int(worksheet_bytes[row_number_start:row_number_end])
                    row_body = worksheet_bytes[row_start:row_end]
                    if (b'<v' in row_body or b'<is' in row_body or b'<f' in row_body):
                        last_value_row = max(last_value_row, row_number)
                row_start = row_end + 6

            merge_start = 0
            while True:
                merge_start = worksheet_bytes.find(b'<mergeCell ', merge_start)
                if merge_start < 0:
                    break
                ref_start = worksheet_bytes.find(b' ref="', merge_start)
                if ref_start >= 0:
                    ref_start += 6
                    ref_end = worksheet_bytes.find(b'"', ref_start)
                    if ref_end > ref_start:
                        merge_refs.append(worksheet_bytes[ref_start:ref_end].decode('utf-8'))
                merge_start += 11

            merge_ranges = []
            for reference in merge_refs:
                try:
                    merge_range = CellRange(reference)
                except ValueError:
                    continue
                merge_ranges.append(merge_range)
                last_value_row = max(last_value_row, merge_range.max_row)
            return last_value_row, merge_ranges
    finally:
        stream.seek(0)


def safe_custom_key(name):
    """生成不会与系统字段冲突的自定义列 key"""
    # 统一使用稳定的 ASCII key，避免表头包含特殊字符、过长或重复时
    # 无法作为前端字段标识的问题。
    normalized = re.sub(r'[^0-9A-Za-z_]+', '_', name).strip('_').lower()
    if not normalized:
        normalized = 'column'
    if normalized[0].isdigit():
        normalized = f'column_{normalized}'
    return f"c_{normalized}"


IMPORT_SYSTEM_HEADER_ALIASES = {
    '用例编号': 'case_no',
    '用例序号': 'case_no',
    '编号': 'case_no',
    'case_no': 'case_no',
    'case no': 'case_no',
    '模块': 'module',
    'module': 'module',
    '标题': 'title',
    '用例标题': 'title',
    'title': 'title',
    '前置条件': 'precondition',
    'precondition': 'precondition',
    '步骤': 'steps',
    '操作步骤': 'steps',
    '测试步骤': 'steps',
    'steps': 'steps',
    '预期结果': 'expected_result',
    '期望结果': 'expected_result',
    'expected_result': 'expected_result',
    '优先级': 'priority',
    'priority': 'priority',
    '执行结果': 'status',
    '测试结果': 'status',
    '状态': 'status',
    'status': 'status',
    '备注': 'remark',
    '说明': 'remark',
    'remark': 'remark',
}


def excel_value_to_text(value):
    """将 Excel 单元格值转换为适合保存到文本字段的内容。"""
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def excel_cell_to_text(cell, preserve_strike=True):
    """读取单元格内容，并把 Excel 的删除线样式保存为安全的 HTML 标记。"""
    value = cell.value if hasattr(cell, 'value') else cell
    text_value = excel_value_to_text(value)
    if not text_value or not preserve_strike:
        return text_value
    font = getattr(cell, 'font', None)
    if font is not None and font.strike:
        return f'<s>{html.escape(text_value, quote=False)}</s>'
    return text_value


def next_case_number(project_id, version_id):
    """返回该版本下下一个可用的数字用例编号。"""
    case_nos = db.session.query(TestCase.case_no).filter_by(
        project_id=project_id, version_id=version_id
    ).all()
    numbers = []
    for (case_no,) in case_nos:
        value = str(case_no or '').strip()
        if value.isdigit():
            numbers.append(int(value))
    return max(numbers, default=0) + 1


STATUS_ALIASES = {
    'pass': '通过', 'passed': '通过', 'success': '通过', '成功': '通过',
    'fail': '失败', 'failed': '失败', 'failure': '失败', '失败': '失败',
    'not run': '未执行', 'notrun': '未执行', 'pending': '未执行', '未执行': '未执行',
    'blocked': '阻塞', 'block': '阻塞', '阻塞': '阻塞',
    'skip': '跳过', 'skipped': '跳过', '跳过': '跳过',
    '通过': '通过',
}


def normalize_status(value):
    """统一 Excel/历史数据中常见的英文和中文执行结果。"""
    text_value = excel_value_to_text(value)
    return STATUS_ALIASES.get(text_value.casefold(), text_value if text_value in STATUS_LIST else '未执行')


@app.route('/api/projects/<int:project_id>/versions/<int:version_id>/import', methods=['POST'])
def import_cases(project_id, version_id):
    file = request.files.get('file')
    if not file:
        return jsonify({'success': False, 'message': '未上传文件'}), 400

    wb = None
    try:
        version = Version.query.filter_by(id=version_id, project_id=project_id).first()
        if not version:
            return jsonify({'success': False, 'message': '项目或版本不存在'}), 404
        init_system_columns(project_id)

        # Werkzeug 的部分上传流（尤其是 SpooledTemporaryFile 包装对象）不一定
        # 实现 seekable()，先复制到标准 BytesIO，兼容 XML 扫描和 openpyxl 只读模式。
        excel_stream = io.BytesIO(file.read())
        last_data_row, worksheet_merges = inspect_excel_bounds(excel_stream)
        wb = openpyxl.load_workbook(excel_stream, read_only=True, data_only=False)
        ws = wb.active
        header_row = next(
            ws.iter_rows(min_row=1, max_row=1, max_col=ws.max_column, values_only=True),
            ()
        )
        if not header_row:
            return jsonify({'success': False, 'message': 'Excel 为空或缺少表头'}), 400

        # 第一行是唯一的列定义。截掉第一行末尾的空单元格，避免 Excel
        # 的格式残留被误识别为额外列；表头中间出现空列则直接提示用户。
        raw_headers = list(header_row)
        last_header_idx = max(
            (idx for idx, value in enumerate(raw_headers) if value is not None and str(value).strip()),
            default=-1
        )
        if last_header_idx < 0:
            return jsonify({'success': False, 'message': 'Excel 第一行缺少表头'}), 400
        headers = [excel_value_to_text(value) for value in raw_headers[:last_header_idx + 1]]
        empty_headers = [str(idx + 1) for idx, header in enumerate(headers) if not header]
        if empty_headers:
            return jsonify({'success': False, 'message': f'第 {"、".join(empty_headers)} 列表头不能为空'}), 400
        if len(set(headers)) != len(headers):
            return jsonify({'success': False, 'message': '第一行存在重复表头，请先修改后再导入'}), 400

        rows = [header_row]
        if last_data_row >= 2:
            rows.extend(ws.iter_rows(
                min_row=2,
                max_row=last_data_row,
                max_col=len(headers),
                values_only=False
            ))

        # 系统字段按表头自动映射，其余表头自动创建为自定义列。
        mapped_headers = [(idx, header, IMPORT_SYSTEM_HEADER_ALIASES.get(header.lower()))
                          for idx, header in enumerate(headers)]
        system_indexes = {mapped for _, _, mapped in mapped_headers if mapped}
        custom_cols = [(idx, header) for idx, header, mapped in mapped_headers if not mapped]

        existing_custom = {c.key: c for c in CustomColumn.query.filter_by(project_id=project_id, is_system=False).all()}
        existing_custom_by_name = {c.name: c for c in existing_custom.values()}
        max_order = db.session.query(db.func.max(CustomColumn.sort_order)).filter_by(project_id=project_id).scalar() or 0
        imported_keys = []
        imported_custom_keys = {}
        for idx, h in custom_cols:
            existing_named = existing_custom_by_name.get(h)
            key = existing_named.key if existing_named else safe_custom_key(h)
            # 兼容历史数据中已经存在的同名列，同时避免不同表头转换成同一个 key。
            original_key = key
            suffix = 2
            while key in existing_custom and existing_custom[key].name != h:
                key = f'{original_key}_{suffix}'
                suffix += 1
            imported_keys.append(key)
            imported_custom_keys[h] = key
            if key not in existing_custom:
                col = CustomColumn(
                    project_id=project_id,
                    name=h,
                    key=key,
                    is_system=False,
                    is_visible=True,
                    width=150,
                    sort_order=max_order + 1
                )
                db.session.add(col)
                existing_custom[key] = col
                existing_custom_by_name[h] = col
                max_order += 1
        db.session.flush()

        # 导入后让表格列与 Excel 表头一致；执行结果仍保留为固定列。
        all_cols = CustomColumn.query.filter_by(project_id=project_id).all()
        system_cols = [c for c in all_cols if c.is_system]
        for c in system_cols:
            c.is_visible = c.key in system_indexes or c.key == 'status'
        for c in existing_custom.values():
            c.is_visible = c.key in imported_keys

        # 导入列的排序也按 Excel 表头排列；未出现在表头中的固定执行结果列放在最后。
        columns_by_key = {c.key: c for c in all_cols}
        imported_column_keys = []
        for _, header, system_key in mapped_headers:
            key = system_key or imported_custom_keys.get(header)
            if key and key in columns_by_key:
                if system_key:
                    columns_by_key[key].name = header
                columns_by_key[key].sort_order = len(imported_column_keys)
                imported_column_keys.append(key)
        next_order = len(imported_column_keys)
        for c in sorted(all_cols, key=lambda col: (col.key != 'status', col.sort_order, col.id)):
            if c.key not in imported_column_keys:
                c.sort_order = next_order
                next_order += 1

        # 导入数据
        created_count = 0
        next_number = next_case_number(project_id, version_id)
        # 保存 Excel 行号，后续用它把工作表中的合并范围映射回导入后的用例。
        vertical_merges = [merged for merged in worksheet_merges
                           if merged.min_row >= 2
                           and merged.min_col == merged.max_col
                           and merged.max_col <= len(headers)]
        merged_row_numbers = {
            row_number
            for merged in vertical_merges
            for row_number in range(merged.min_row, merged.max_row + 1)
        }

        data_rows = []
        for excel_row_number, row in enumerate(rows[1:], start=2):
            values = list(row[:len(headers)])
            # 合并单元格的非首行通常没有值；即使整行为空，也要保留为一条用例，
            # 否则无法还原 Excel 中的纵向合并关系。
            if (not any(cell.value is not None and str(cell.value).strip() for cell in values)
                    and excel_row_number not in merged_row_numbers):
                continue
            data_rows.append((excel_row_number, values))

        sort_orders = compute_sort_orders(project_id, version_id, count=len(data_rows)) if data_rows else []
        imported_case_ids_by_row = {}
        for row_idx, (excel_row_number, row) in enumerate(data_rows):
            custom_fields = {}
            for idx, h in custom_cols:
                key = imported_custom_keys[h]
                custom_fields[key] = excel_cell_to_text(row[idx]) if idx < len(row) else ''

            values_by_system_key = {}
            for idx, header, system_key in mapped_headers:
                if system_key:
                    # 执行结果需要保持为纯文本供状态选择器识别，其余字段保留删除线。
                    values_by_system_key[system_key] = excel_cell_to_text(
                        row[idx], preserve_strike=system_key not in {'status'}
                    ) if idx < len(row) else ''

            status = normalize_status(values_by_system_key.get('status', '未执行'))

            case = TestCase(
                project_id=project_id,
                version_id=version_id,
                # 表格未填写编号时按导入顺序自动生成 1、2、3……；已有数据则从最大数字继续。
                case_no=values_by_system_key.get('case_no') or str(next_number),
                module=values_by_system_key.get('module', ''),
                title=values_by_system_key.get('title', ''),
                precondition=values_by_system_key.get('precondition', ''),
                steps=values_by_system_key.get('steps', ''),
                expected_result=values_by_system_key.get('expected_result', ''),
                priority=values_by_system_key.get('priority', ''),
                status=status,
                remark=values_by_system_key.get('remark', ''),
                sort_order=sort_orders[row_idx]
            )
            case.set_custom_fields(custom_fields)
            db.session.add(case)
            db.session.flush()
            imported_case_ids_by_row[excel_row_number] = case.id
            created_count += 1
            if not values_by_system_key.get('case_no'):
                next_number += 1

        # 自动还原 Excel 中同一列的纵向合并。横向合并无法映射到当前用例表的
        # “同一列跨行”模型，因此保留原数据但不创建错误的合并记录。
        imported_keys_by_column = {
            index + 1: (system_key or imported_custom_keys.get(header))
            for index, header, system_key in mapped_headers
        }
        for merged in vertical_merges:
            column_key = imported_keys_by_column.get(merged.min_col)
            case_ids = [
                imported_case_ids_by_row[row_number]
                for row_number in range(merged.min_row, merged.max_row + 1)
                if row_number in imported_case_ids_by_row
            ]
            if not column_key or len(case_ids) < 2:
                continue
            already_merged = False
            for existing_merge in CaseMerge.query.filter_by(
                    project_id=project_id, version_id=version_id, column_key=column_key).all():
                if set(existing_merge.get_case_ids()).intersection(case_ids):
                    already_merged = True
                    break
            if not already_merged:
                imported_merge = CaseMerge(
                    project_id=project_id,
                    version_id=version_id,
                    column_key=column_key
                )
                imported_merge.set_case_ids(case_ids)
                db.session.add(imported_merge)

        db.session.commit()
        return jsonify({'success': True, 'data': {'imported': created_count}})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'导入失败: {str(e)}'}), 500
    finally:
        if wb is not None:
            wb.close()


# ------------------- 图片上传 -------------------
@app.route('/api/cases/<int:case_id>/images', methods=['POST'])
def upload_image(case_id):
    case = TestCase.query.get_or_404(case_id)
    files = request.files.getlist('images')
    saved = []
    for file in files:
        if not file or not file.filename:
            continue
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']:
            continue
        filename = f"{uuid.uuid4().hex}{ext}"
        folder = os.path.join(config.UPLOAD_DIR, str(case_id))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, filename)
        file.save(path)
        img = CaseImage(test_case_id=case_id, filename=file.filename, file_path=path)
        db.session.add(img)
        saved.append(img)
    db.session.commit()
    return jsonify({'success': True, 'data': [i.to_dict() for i in saved]})


@app.route('/api/cases/<int:case_id>/images', methods=['GET'])
def get_images(case_id):
    images = CaseImage.query.filter_by(test_case_id=case_id).all()
    return jsonify({'success': True, 'data': [i.to_dict() for i in images]})


@app.route('/api/images/<int:image_id>', methods=['DELETE'])
def delete_image(image_id):
    img = CaseImage.query.get_or_404(image_id)
    try:
        if os.path.exists(img.file_path):
            os.remove(img.file_path)
    except Exception:
        pass
    db.session.delete(img)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(config.UPLOAD_DIR, filename)


# ------------------- 数据库备份 -------------------
@app.route('/api/backup', methods=['POST'])
def backup_database():
    data = request.json or {}
    backup_dir = data.get('backup_dir', config.BACKUP_DIR)
    try:
        os.makedirs(backup_dir, exist_ok=True)
    except Exception as e:
        return jsonify({'success': False, 'message': f'无法创建备份目录: {str(e)}'}), 400

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"case_manager_backup_{timestamp}.sql"
    filepath = os.path.join(backup_dir, filename)

    # 优先使用 mysqldump
    mysqldump = shutil.which('mysqldump')
    if mysqldump:
        cmd = [
            mysqldump,
            '-h', config.DB_HOST,
            '-P', str(config.DB_PORT),
            '-u', config.DB_USER,
            f'--password={config.DB_PASSWORD}',
            '--single-transaction',
            '--routines',
            '--triggers',
            config.DB_NAME
        ]
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                subprocess.run(cmd, stdout=f, check=True)
            return jsonify({'success': True, 'data': {'path': filepath}})
        except subprocess.CalledProcessError as e:
            return jsonify({'success': False, 'message': f'mysqldump 失败: {str(e)}'}), 500
    else:
        # 降级：导出核心表为 JSON
        try:
            import_data = {
                'projects': [p.to_dict() for p in Project.query.all()],
                'versions': [v.to_dict() for v in Version.query.all()],
                'columns': [c.to_dict() for c in CustomColumn.query.all()],
                'cases': [c.to_dict() for c in TestCase.query.all()],
                'merges': [m.to_dict() for m in CaseMerge.query.all()],
            }
            with open(filepath.replace('.sql', '.json'), 'w', encoding='utf-8') as f:
                json.dump(import_data, f, ensure_ascii=False, indent=2)
            return jsonify({'success': True, 'data': {'path': filepath.replace('.sql', '.json'), 'note': '未找到 mysqldump，已导出为 JSON'}})
        except Exception as e:
            return jsonify({'success': False, 'message': f'备份失败: {str(e)}'}), 500


# ------------------- 初始化 -------------------
@app.cli.command('init-db')
def init_db_command():
    create_database()
    db.create_all()
    migrate_sort_order()
    print('数据库初始化完成')


def migrate_sort_order():
    """为已有用例和版本补 sort_order 字段并初始化。"""
    try:
        with db.engine.connect() as conn:
            for column, definition in (
                ('precondition', "TEXT"),
                ('expected_result', "TEXT"),
                ('priority', "VARCHAR(50) DEFAULT ''"),
            ):
                try:
                    conn.execute(text(f"ALTER TABLE test_cases ADD COLUMN {column} {definition}"))
                except Exception:
                    pass  # 字段已存在
            try:
                conn.execute(text("ALTER TABLE test_cases ADD COLUMN sort_order INT DEFAULT 0"))
            except Exception:
                pass  # 字段已存在
            conn.execute(text("UPDATE test_cases SET sort_order = id * 1000 WHERE sort_order = 0"))
            version_sort_added = False
            try:
                conn.execute(text("ALTER TABLE versions ADD COLUMN sort_order INT DEFAULT 0"))
                version_sort_added = True
            except Exception:
                pass  # 字段已存在
            # 首次迁移时保持原来按创建时间倒序的显示顺序；后续启动不触碰用户排序。
            if version_sort_added:
                rows = conn.execute(text(
                    "SELECT id FROM versions ORDER BY created_at DESC, id DESC"
                )).fetchall()
                for offset, row in enumerate(rows):
                    conn.execute(text("UPDATE versions SET sort_order = :sort_order WHERE id = :id"),
                                 {'sort_order': offset, 'id': row[0]})
            conn.commit()
    except Exception as e:
        print('sort_order 迁移提示:', e)


if __name__ == '__main__':
    with app.app_context():
        create_database()
        db.create_all()
        migrate_sort_order()
    app.run(host='0.0.0.0', port=5005, debug=True)
