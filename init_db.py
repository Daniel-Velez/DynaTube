import psycopg2
import os
import time
from backend.app import init_db, DB_CONFIG

def wait_and_init():
    print("⏳ Esperando base de datos...")
    # Esperar unos segundos para asegurar que Postgres esté listo
    time.sleep(5) 
    try:
        init_db()
        print("✅ Tablas creadas correctamente.")
    except Exception as e:
        print(f"❌ Error inicializando DB: {e}")

if __name__ == "__main__":
    wait_and_init()