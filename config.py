import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# MySQL 配置
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = int(os.getenv('DB_PORT', '3306'))
DB_USER = os.getenv('DB_USER', 'root')
DB_PASSWORD = os.getenv('DB_PASSWORD', '123456')
DB_NAME = os.getenv('DB_NAME', 'case_manager')

# 数据库备份目录
BACKUP_DIR = os.getenv('BACKUP_DIR', os.path.join(BASE_DIR, 'backups'))

# 项目删除密码
DELETE_PASSWORD = os.getenv('DELETE_PASSWORD', '000000')

# Flask 会话签名；账号、密码和角色均存储在 MySQL，不再由配置文件维护。
SECRET_KEY = os.getenv('SECRET_KEY', 'case-manager-local-secret-change-me')

os.makedirs(BACKUP_DIR, exist_ok=True)

SQLALCHEMY_DATABASE_URI = (
    f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    "?charset=utf8mb4"
)
