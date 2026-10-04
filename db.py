import os
import pymysql
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    ssl_ca = os.getenv("DB_SSL_CA")
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", "17062007"),
        database=os.getenv("DB_NAME", "ride_sharing_db"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        ssl={"ca": ssl_ca} if ssl_ca else None,
        connect_timeout=10,
        autocommit=True,
    )