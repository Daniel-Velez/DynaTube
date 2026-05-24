from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity, get_jwt
import yt_dlp
import psycopg2
import psycopg2.extras
import os
import tempfile
import shutil
import time
import uuid
import re
from pathlib import Path
from typing import Dict, List, Optional
import threading
from contextlib import contextmanager
import subprocess
from dotenv import load_dotenv

# Corrección para el empaquetado como módulo en Docker
from .auth import auth_bp  
from functools import wraps

# ==========================================
# CONFIGURACIÓN DE SEGURIDAD
# ==========================================
load_dotenv()

def admin_required():
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            claims = get_jwt()
            if claims.get("is_admin"):
                return fn(*args, **kwargs)
            else:
                return jsonify(msg="Acceso denegado. Se requieren permisos de administrador."), 403
        return decorator
    return wrapper

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}})

app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'super-secret-key-change-in-production')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 3600))
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = int(os.getenv('JWT_REFRESH_TOKEN_EXPIRES', 2592000))
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'

jwt = JWTManager(app)
app.register_blueprint(auth_bp, url_prefix='/api/auth')

DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'admin'),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5432')
}

DOWNLOADS_DIR = Path(os.getenv('DOWNLOADS_DIR', str(Path.home() / "Downloads/DynaTube")))
DOWNLOADS_DIR.mkdir(exist_ok=True, parents=True)

TEMP_DIR = Path(tempfile.gettempdir()) / "dynatube_web"
TEMP_DIR.mkdir(exist_ok=True)

active_tasks: Dict[str, Dict] = {}
task_lock = threading.Lock()

COOKIES_FILE = Path(__file__).parent / "cookies.txt"
USE_COOKIES_FILE = COOKIES_FILE.exists()

# ==========================================
# BASE DE DATOS
# ==========================================
@contextmanager
def get_db_connection():
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        yield conn
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        print(f"Error en base de datos: {e}")
        raise
    finally:
        conn.close()

def init_db():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    email VARCHAR(100) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name VARCHAR(100),
                    avatar_url TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    is_admin BOOLEAN DEFAULT FALSE,
                    last_login TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS downloads (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    video_id VARCHAR(255),
                    title TEXT NOT NULL,
                    thumbnail_url TEXT,
                    file_path TEXT,
                    file_size BIGINT,
                    format VARCHAR(50),
                    status VARCHAR(50) DEFAULT 'completed',
                    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    type TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL,
                    ip_address VARCHAR(45),
                    user_agent TEXT,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_date ON downloads(date DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_user_downloads ON downloads(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_session_token ON sessions(token_hash)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id)")
            
            from .auth import hash_password
            cur.execute("SELECT id FROM users WHERE username = 'admin'")
            if not cur.fetchone():
                admin_hash = hash_password('admin123')
                cur.execute("""
                    INSERT INTO users (username, email, password_hash, full_name, is_admin, is_active)
                    VALUES ('admin', 'admin@dynatube.local', %s, 'Administrador', TRUE, TRUE)
                """, (admin_hash,))
                print("✅ Usuario admin creado: admin / admin123")

def add_to_history(title: str, tipo: str, url: str = "", file_path: str = "", user_id: int = None):
    if user_id is None:
        return
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO downloads (title, type, video_id, file_path, user_id, status) 
                       VALUES (%s, %s, %s, %s, %s, 'completed')""",
                    (title, tipo, url, file_path, user_id)
                )
    except psycopg2.Error as e:
        print(f"Error guardando historial: {e}")

# ==========================================
# UTILIDADES
# ==========================================
def sanitize_filename(filename: str, max_length: int = 200) -> str:
    # Solo reemplaza caracteres ilegales en Windows/Linux, manteniendo tildes y caracteres especiales
    forbidden_chars = r'[<>:"/\\|?*]'
    sanitized = re.sub(forbidden_chars, '_', filename)
    sanitized = " ".join(sanitized.split())
    sanitized = sanitized.strip()[:max_length]
    return sanitized if sanitized else "descarga_sin_titulo"

def cleanup_old_files(directory: Path, older_than_hours: int = 24):
    current_time = time.time()
    for file in directory.glob("*"):
        try:
            if current_time - file.stat().st_mtime > (older_than_hours * 3600):
                if file.is_file():
                    file.unlink()
                elif file.is_dir():
                    shutil.rmtree(file)
        except Exception as e:
            print(f"Error limpiando {file}: {e}")

@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ==========================================
# ENDPOINT BÚSQUEDA
# ==========================================
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/search', methods=['POST'])
def search_videos():
    data = request.json
    query = data.get('query', '')
    start_index = data.get('start_index', 0)
    limit = data.get('limit', 20)

    if not query:
        return jsonify({'error': 'Query vacío'}), 400

    is_link = "http" in query

    opts = {
        'quiet': True,
        'skip_download': True,
        'noplaylist': True,
        'ignoreerrors': True,
        'no_warnings': True,
        'remote_components': ['ejs:npm'],
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    if USE_COOKIES_FILE:
        opts['cookies'] = str(COOKIES_FILE)
    else:
        opts['cookiesfrombrowser'] = ('firefox',)

    if is_link:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                result = ydl.extract_info(query, download=False)
                if not result or not result.get('id'):
                    return jsonify({'videos': [], 'has_more': False})
                entry = result
                v_id = entry.get('id')
                duration = entry.get('duration')
                if duration:
                    mins, secs = divmod(duration, 60)
                    duration_str = f"{int(mins)}:{int(secs):02d}"
                else:
                    duration_str = "Live" if entry.get('is_live') else "0:00"
                videos = [{
                    'titulo': entry.get('title', 'Sin título'),
                    'url': f"https://www.youtube.com/watch?v={v_id}",
                    'thumb': f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                    'duracion': duration_str,
                    'uploader': entry.get('uploader', 'YouTube')
                }]
                return jsonify({'videos': videos, 'has_more': False})
        except Exception as e:
            print(f"Error en búsqueda de enlace: {e}")
            return jsonify({'error': str(e)}), 500
    else:
        search_query = f"ytsearch{start_index + limit + 5}:{query}"
        opts['extract_flat'] = True
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                result = ydl.extract_info(search_query, download=False)
                if not result:
                    return jsonify({'videos': [], 'has_more': False})
                entries = result.get('entries', [])
                paginated = entries[start_index:start_index + limit]
                has_more = len(entries) > start_index + limit
                videos = []
                for entry in paginated:
                    if not entry or not entry.get('id'):
                        continue
                    v_id = entry.get('id')
                    duration = entry.get('duration')
                    if duration:
                        mins, secs = divmod(duration, 60)
                        duration_str = f"{int(mins)}:{int(secs):02d}"
                    else:
                        duration_str = "Live" if entry.get('is_live') else "0:00"
                    videos.append({
                        'titulo': entry.get('title', 'Sin título'),
                        'url': f"https://www.youtube.com/watch?v={v_id}",
                        'thumb': f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                        'duracion': duration_str,
                        'uploader': entry.get('uploader', 'YouTube')
                    })
                return jsonify({'videos': videos, 'has_more': has_more})
        except Exception as e:
            print(f"Error en búsqueda: {e}")
            return jsonify({'error': str(e)}), 500

# ==========================================
# CALIDADES
# ==========================================
@app.route('/api/qualities', methods=['GET'])
def get_qualities():
    video_url = request.args.get('url')
    if not video_url:
        return jsonify({'error': 'URL no proporcionada'}), 400

    opts = {
        'quiet': True,
        'skip_download': True,
        'no_warnings': True,
        'noplaylist': True,
        'remote_components': ['ejs:npm'],
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    if USE_COOKIES_FILE:
        opts['cookies'] = str(COOKIES_FILE)
    else:
        opts['cookiesfrombrowser'] = ('firefox',)

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            qualities = []
            seen = set()
            for fmt in info.get('formats', []):
                vcodec = fmt.get('vcodec')
                if not vcodec or vcodec == 'none':
                    continue
                height = fmt.get('height')
                if not height:
                    continue
                if height >= 2160:
                    label = "2160p (4K)"
                elif height >= 1440:
                    label = "1440p (2K)"
                elif height >= 1080:
                    label = "1080p (Full HD)"
                elif height >= 720:
                    label = "720p (HD)"
                elif height >= 480:
                    label = "480p"
                elif height >= 360:
                    label = "360p"
                else:
                    label = f"{height}p"
                ext = fmt.get('ext', 'mp4').upper()
                fps = fmt.get('fps')
                fps_str = f" {int(fps)}fps" if fps else ""
                size_bytes = fmt.get('filesize') or fmt.get('filesize_approx')
                size_str = f" · {size_bytes/(1024*1024):.1f} MB" if size_bytes else ""
                display = f"{label} - {ext}{fps_str}{size_str}"
                if display not in seen:
                    seen.add(display)
                    qualities.append({
                        'resolution': display,
                        'format_id': fmt['format_id'],
                        'ext': fmt.get('ext'),
                        'height': height,
                        'filesize': size_bytes
                    })
            qualities.sort(key=lambda x: x['height'], reverse=True)
            return jsonify({
                'title': info.get('title'),
                'thumbnail': info.get('thumbnail'),
                'qualities': qualities
            })
    except Exception as e:
        print(f"Error en qualities: {e}")
        return jsonify({'error': str(e)}), 500

# ==========================================
# DESCARGA
# ==========================================
def download_task(task_id: str, url: str, tipo: str, format_id: Optional[str], titulo: str, user_id: int = None):
    try:
        with task_lock:
            active_tasks[task_id]['status'] = 'downloading'

        safe_title = sanitize_filename(titulo)
        output_dir = DOWNLOADS_DIR / task_id
        output_dir.mkdir(exist_ok=True, parents=True)
        template = str(output_dir / f"{safe_title}.%(ext)s")

        def progress_hook(d):
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate')
                downloaded = d.get('downloaded_bytes', 0)
                if total:
                    progress = int(downloaded / total * 100)
                    with task_lock:
                        if task_id in active_tasks:
                            active_tasks[task_id].update({
                                'progress': progress,
                                'downloaded_mb': round(downloaded/(1024*1024), 1),
                                'total_mb': round(total/(1024*1024), 1)
                            })

        opts = {
            'outtmpl': template,
            'quiet': True,
            'progress_hooks': [progress_hook],
            'restrictfilenames': True,
            'noplaylist': True,
            'remote_components': ['ejs:npm'],
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        if USE_COOKIES_FILE:
            opts['cookies'] = str(COOKIES_FILE)
            opts['nocheckcertificate'] = True
        else:
            opts['cookiesfrombrowser'] = ('firefox',)

        if tipo == 'audio':
            opts.update({
                'format': 'bestaudio/best',
                'writethumbnail': True,
                'embedthumbnail': True,
                'postprocessors': [
                    {'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'},
                    {'key': 'EmbedThumbnail'},
                    {'key': 'FFmpegMetadata'}
                ]
            })
        else:
            # SOLUCIÓN: Pedimos a YouTube explícitamente la pista de audio en formato m4a (AAC)
            # Esto evita tener que reconvertir el audio con FFmpeg y elimina el error de Opus.
            if format_id:
                opts['format'] = f"{format_id}+bestaudio[ext=m4a]/bestaudio/best"
                print(f"🎯 Solicitando formato específico con audio AAC: {format_id}")
            else:
                opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
                print(f"🎯 Formato por defecto (Video MP4 + Audio AAC): {opts['format']}")
            
            opts['merge_output_format'] = 'mp4'
            
            # Solo nos aseguramos de que el contenedor final sea mp4
            opts['postprocessors'] = [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }]

        print(f"🎬 Descargando: {titulo}")
        print(f"📁 Tipo: {tipo}")
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        final_path = None
        if output_dir.exists():
            files = [f for f in os.listdir(output_dir) if os.path.isfile(output_dir / f)]
            if files:
                actual_name = [f for f in files if not f.endswith(('.part', '.ytdl'))][0]
                final_path = output_dir / actual_name

        if final_path and final_path.exists():
            with task_lock:
                active_tasks[task_id].update({
                    'status': 'completed',
                    'progress': 100,
                    'file_path': str(final_path.absolute())
                })
            if user_id:
                add_to_history(titulo, tipo, url, str(final_path.absolute()), user_id)
            print(f"✅ Descarga completada: {final_path.name}")
        else:
            raise Exception("No se encontró el archivo descargado")
    except Exception as e:
        print(f"❌ Error en descarga: {e}")
        import traceback
        traceback.print_exc()
        with task_lock:
            if task_id in active_tasks:
                active_tasks[task_id].update({'status': 'error', 'error': str(e)})

@app.route('/api/download', methods=['POST'])
@jwt_required(optional=True)
def start_download():
    data = request.json
    url = data.get('url')
    current_user_id = get_jwt_identity()
    if not url:
        return jsonify({'error': 'URL no proporcionada'}), 400

    task_id = str(uuid.uuid4())
    with task_lock:
        active_tasks[task_id] = {
            'id': task_id,
            'titulo': data.get('titulo', 'video'),
            'status': 'pending',
            'progress': 0,
            'tipo': data.get('tipo', 'video')
        }
    threading.Thread(target=download_task, args=(task_id, url, data.get('tipo'), data.get('format_id'), data.get('titulo'), current_user_id), daemon=True).start()
    return jsonify({'task_id': task_id, 'status': 'pending'})

@app.route('/api/task/<task_id>', methods=['GET'])
def get_task_status(task_id):
    with task_lock:
        task = active_tasks.get(task_id)
        return jsonify(task if task else {'error': 'No encontrada'}), (200 if task else 404)

@app.route('/api/download/<task_id>', methods=['GET'])
def download_file(task_id):
    with task_lock:
        task = active_tasks.get(task_id)
    if not task or task.get('status') != 'completed':
        return jsonify({'error': 'Archivo no listo'}), 400
    file_path = Path(task.get('file_path'))
    if file_path.exists():
        return send_file(file_path, as_attachment=True, download_name=file_path.name)
    return jsonify({'error': 'No se encontró el archivo'}), 404

@app.route('/api/task/<task_id>', methods=['DELETE'])
def cancel_task(task_id):
    with task_lock:
        if task_id in active_tasks:
            shutil.rmtree(DOWNLOADS_DIR / task_id, ignore_errors=True)
            del active_tasks[task_id]
            return jsonify({'success': True})
    return jsonify({'error': 'No encontrada'}), 404

# ==========================================
# CONVERSIÓN, HISTORIAL, ADMIN
# ==========================================
@app.route('/api/convert', methods=['POST'])
def convert_to_mp3():
    if 'file' not in request.files:
        return jsonify({'error': 'Sin archivo'}), 400
    file = request.files['file']
    task_id = str(uuid.uuid4())
    temp_dir = TEMP_DIR / task_id
    temp_dir.mkdir(exist_ok=True)
    input_path = temp_dir / file.filename
    output_path = temp_dir / f"{os.path.splitext(file.filename)[0]}.mp3"
    file.save(input_path)
    try:
        subprocess.run(['ffmpeg', '-y', '-i', str(input_path), '-vn', '-ab', '192k', str(output_path)], check=True, capture_output=True)
        return send_file(output_path, as_attachment=True, download_name=output_path.name)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        threading.Timer(60, lambda: shutil.rmtree(temp_dir, ignore_errors=True)).start()

@app.route('/api/history', methods=['GET'])
@jwt_required()
def get_history():
    current_user_id = get_jwt_identity()
    limit = request.args.get('limit', 100, type=int)
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("SELECT title, type, date, video_id as url FROM downloads WHERE user_id = %s ORDER BY date DESC LIMIT %s", (current_user_id, limit))
                return jsonify([dict(row) for row in cur.fetchall()]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history', methods=['DELETE'])
@jwt_required()
def clear_history_endpoint():
    current_user_id = get_jwt_identity()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM downloads WHERE user_id = %s", (current_user_id,))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/stats', methods=['GET'])
@admin_required()
def get_admin_stats():
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("SELECT COUNT(*) as total FROM users")
                total_users = cur.fetchone()['total']
                cur.execute("SELECT COUNT(*) as total FROM users WHERE is_active = TRUE")
                active_users = cur.fetchone()['total']
                cur.execute("SELECT COUNT(*) as total FROM downloads")
                total_downloads = cur.fetchone()['total']
                cur.execute("SELECT COUNT(*) as total FROM downloads WHERE date >= CURRENT_DATE")
                downloads_today = cur.fetchone()['total']
                downloads_size = sum(f.stat().st_size for f in DOWNLOADS_DIR.rglob('*') if f.is_file())
                temp_size = sum(f.stat().st_size for f in TEMP_DIR.rglob('*') if f.is_file())
                total_disk_mb = (downloads_size + temp_size) / (1024 * 1024)
                with task_lock:
                    active_tasks_count = len(active_tasks)
                cur.execute("""
                    SELECT u.username, u.email, COUNT(d.id) as download_count
                    FROM users u
                    LEFT JOIN downloads d ON u.id = d.user_id
                    GROUP BY u.id, u.username, u.email
                    ORDER BY download_count DESC
                    LIMIT 5
                """)
                top_users = [dict(row) for row in cur.fetchall()]
                cur.execute("""
                    SELECT DATE(date) as day, COUNT(*) as count
                    FROM downloads
                    WHERE date >= CURRENT_DATE - INTERVAL '7 days'
                    GROUP BY DATE(date)
                    ORDER BY day DESC
                """)
                downloads_by_day = [dict(row) for row in cur.fetchall()]
                return jsonify({
                    'users': {'total': total_users, 'active': active_users},
                    'downloads': {'total': total_downloads, 'today': downloads_today},
                    'system': {'disk_usage_mb': round(total_disk_mb, 2), 'active_tasks': active_tasks_count},
                    'top_users': top_users,
                    'downloads_by_day': downloads_by_day
                }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/users', methods=['GET'])
@admin_required()
def get_all_users():
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.is_admin, 
                           u.created_at, u.last_login,
                           COUNT(d.id) as download_count
                    FROM users u
                    LEFT JOIN downloads d ON u.id = d.user_id
                    GROUP BY u.id
                    ORDER BY u.created_at DESC
                """)
                return jsonify([dict(row) for row in cur.fetchall()]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@admin_required()
def update_user(user_id):
    data = request.json
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if 'is_active' in data:
                    cur.execute("UPDATE users SET is_active = %s WHERE id = %s", (data['is_active'], user_id))
                if 'is_admin' in data:
                    cur.execute("UPDATE users SET is_admin = %s WHERE id = %s", (data['is_admin'], user_id))
                return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required()
def delete_user(user_id):
    current_user_id = get_jwt_identity()
    if str(user_id) == str(current_user_id):
        return jsonify({'error': 'No puedes eliminarte a ti mismo'}), 400
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
                return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/downloads', methods=['GET'])
@admin_required()
def get_all_downloads():
    limit = request.args.get('limit', 100, type=int)
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT d.*, u.username 
                    FROM downloads d
                    LEFT JOIN users u ON d.user_id = u.id
                    ORDER BY d.date DESC
                    LIMIT %s
                """, (limit,))
                return jsonify([dict(row) for row in cur.fetchall()]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/cleanup', methods=['POST'])
@admin_required()
def force_cleanup():
    try:
        cleanup_old_files(DOWNLOADS_DIR, 0)
        cleanup_old_files(TEMP_DIR, 0)
        return jsonify({'success': True, 'message': 'Limpieza completada'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/sessions', methods=['GET'])
@admin_required()
def get_active_sessions():
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT s.id, s.user_id, u.username, s.ip_address, s.user_agent, 
                           s.created_at, s.expires_at
                    FROM sessions s
                    JOIN users u ON s.user_id = u.id
                    WHERE s.expires_at > NOW()
                    ORDER BY s.created_at DESC
                """)
                return jsonify([dict(row) for row in cur.fetchall()]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/sessions/<int:session_id>', methods=['DELETE'])
@admin_required()
def revoke_session(session_id):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
                return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==========================================
# LIMPIEZA PERIÓDICA
# ==========================================
def cleanup_routine():
    while True:
        time.sleep(3600)
        cleanup_old_files(DOWNLOADS_DIR, 24)
        cleanup_old_files(TEMP_DIR, 6)

if __name__ == '__main__':
    init_db()
    threading.Thread(target=cleanup_routine, daemon=True).start()
    app.run(debug=app.config['DEBUG'], host='0.0.0.0', port=5000)