"""
Utilidades y helpers para Dynatube Pro
"""
import os
import time
import re
import hashlib
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import logging

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ==========================================
# SANITIZACIÓN Y VALIDACIÓN
# ==========================================
def sanitize_filename(filename: str, max_length: int = 200) -> str:
    """
    Sanitiza nombres de archivo removiendo caracteres no permitidos
    
    Args:
        filename: Nombre del archivo a sanitizar
        max_length: Longitud máxima del nombre
        
    Returns:
        Nombre de archivo sanitizado
    """
    # Caracteres permitidos
    valid_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_")
    
    # Remover caracteres inválidos
    sanitized = "".join(c if c in valid_chars else "_" for c in filename)
    
    # Normalizar espacios
    sanitized = " ".join(sanitized.split())
    
    # Truncar a longitud máxima
    sanitized = sanitized.strip()[:max_length]
    
    return sanitized if sanitized else "descarga_sin_titulo"


def validate_url(url: str) -> bool:
    """
    Valida si una URL es válida para YouTube
    
    Args:
        url: URL a validar
        
    Returns:
        True si es válida, False en caso contrario
    """
    youtube_patterns = [
        r'(https?://)?(www\.)?(youtube|youtu|youtube-nocookie)\.(com|be)/',
        r'(https?://)?(www\.)?youtube\.com/watch\?v=',
        r'(https?://)?(www\.)?youtu\.be/',
    ]
    
    return any(re.match(pattern, url) for pattern in youtube_patterns)


def validate_file_extension(filename: str, allowed_extensions: List[str]) -> bool:
    """
    Valida la extensión de un archivo
    
    Args:
        filename: Nombre del archivo
        allowed_extensions: Lista de extensiones permitidas (sin punto)
        
    Returns:
        True si la extensión es válida
    """
    if not filename:
        return False
    
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return extension in [ext.lower() for ext in allowed_extensions]


# ==========================================
# GESTIÓN DE ARCHIVOS
# ==========================================
def cleanup_old_files(directory: Path, older_than_hours: int = 24) -> int:
    """
    Limpia archivos y directorios antiguos
    
    Args:
        directory: Directorio a limpiar
        older_than_hours: Antigüedad mínima en horas
        
    Returns:
        Número de archivos eliminados
    """
    if not directory.exists():
        return 0
    
    current_time = time.time()
    cutoff_time = current_time - (older_than_hours * 3600)
    deleted_count = 0
    
    try:
        for item in directory.iterdir():
            try:
                item_mtime = item.stat().st_mtime
                
                if item_mtime < cutoff_time:
                    if item.is_file():
                        item.unlink()
                        deleted_count += 1
                        logger.info(f"Archivo eliminado: {item}")
                    elif item.is_dir():
                        import shutil
                        shutil.rmtree(item)
                        deleted_count += 1
                        logger.info(f"Directorio eliminado: {item}")
            except Exception as e:
                logger.error(f"Error eliminando {item}: {e}")
                
    except Exception as e:
        logger.error(f"Error accediendo a {directory}: {e}")
    
    return deleted_count


def get_file_size(file_path: Path) -> Optional[int]:
    """
    Obtiene el tamaño de un archivo en bytes
    
    Args:
        file_path: Ruta del archivo
        
    Returns:
        Tamaño en bytes o None si hay error
    """
    try:
        return file_path.stat().st_size if file_path.exists() else None
    except Exception as e:
        logger.error(f"Error obteniendo tamaño de {file_path}: {e}")
        return None


def format_file_size(bytes_size: int) -> str:
    """
    Formatea tamaño de archivo a formato legible
    
    Args:
        bytes_size: Tamaño en bytes
        
    Returns:
        Tamaño formateado (ej: "1.5 MB")
    """
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} PB"


def ensure_directory(directory: Path) -> bool:
    """
    Asegura que un directorio existe, creándolo si es necesario
    
    Args:
        directory: Directorio a verificar/crear
        
    Returns:
        True si existe o se creó exitosamente
    """
    try:
        directory.mkdir(parents=True, exist_ok=True)
        return True
    except Exception as e:
        logger.error(f"Error creando directorio {directory}: {e}")
        return False


# ==========================================
# HASHING Y CACHÉ
# ==========================================
def generate_cache_key(*args) -> str:
    """
    Genera una clave de caché a partir de múltiples argumentos
    
    Args:
        *args: Argumentos para generar la clave
        
    Returns:
        Hash MD5 de los argumentos
    """
    key_string = "_".join(str(arg) for arg in args)
    return hashlib.md5(key_string.encode()).hexdigest()


def generate_task_id() -> str:
    """
    Genera un ID único para una tarea
    
    Returns:
        ID único basado en timestamp y random
    """
    import uuid
    return str(uuid.uuid4())


# ==========================================
# FORMATEO DE TIEMPO
# ==========================================
def format_duration(seconds: int) -> str:
    """
    Formatea duración en segundos a formato MM:SS o HH:MM:SS
    
    Args:
        seconds: Duración en segundos
        
    Returns:
        Duración formateada
    """
    if seconds < 3600:
        minutes = seconds // 60
        secs = seconds % 60
        return f"{minutes}:{secs:02d}"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        secs = seconds % 60
        return f"{hours}:{minutes:02d}:{secs:02d}"


def parse_duration(duration_str: str) -> Optional[int]:
    """
    Parsea una cadena de duración a segundos
    
    Args:
        duration_str: Duración en formato "MM:SS" o "HH:MM:SS"
        
    Returns:
        Duración en segundos o None si hay error
    """
    try:
        parts = duration_str.split(':')
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        return None
    except:
        return None


def get_timestamp() -> str:
    """
    Obtiene timestamp actual formateado
    
    Returns:
        Timestamp en formato ISO
    """
    return datetime.now().isoformat()


def format_date(date_str: str) -> str:
    """
    Formatea una fecha a formato legible
    
    Args:
        date_str: Fecha en formato ISO
        
    Returns:
        Fecha formateada
    """
    try:
        dt = datetime.fromisoformat(date_str)
        return dt.strftime("%d/%m/%Y %H:%M")
    except:
        return date_str


# ==========================================
# RATE LIMITING
# ==========================================
class RateLimiter:
    """
    Limitador de tasa simple basado en memoria
    """
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = {}
    
    def is_allowed(self, identifier: str) -> bool:
        """
        Verifica si una solicitud está permitida
        
        Args:
            identifier: Identificador único (IP, user_id, etc.)
            
        Returns:
            True si está permitido
        """
        current_time = time.time()
        
        # Inicializar si no existe
        if identifier not in self.requests:
            self.requests[identifier] = []
        
        # Limpiar solicitudes antiguas
        self.requests[identifier] = [
            req_time for req_time in self.requests[identifier]
            if current_time - req_time < self.window_seconds
        ]
        
        # Verificar límite
        if len(self.requests[identifier]) >= self.max_requests:
            return False
        
        # Agregar nueva solicitud
        self.requests[identifier].append(current_time)
        return True
    
    def get_remaining(self, identifier: str) -> int:
        """
        Obtiene el número de solicitudes restantes
        
        Args:
            identifier: Identificador único
            
        Returns:
            Número de solicitudes restantes
        """
        current_time = time.time()
        
        if identifier not in self.requests:
            return self.max_requests
        
        # Limpiar antiguas
        self.requests[identifier] = [
            req_time for req_time in self.requests[identifier]
            if current_time - req_time < self.window_seconds
        ]
        
        return max(0, self.max_requests - len(self.requests[identifier]))
    
    def reset(self, identifier: str):
        """
        Resetea el contador para un identificador
        
        Args:
            identifier: Identificador único
        """
        if identifier in self.requests:
            del self.requests[identifier]


# ==========================================
# VALIDACIÓN DE DATOS
# ==========================================
def validate_download_request(data: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """
    Valida los datos de una solicitud de descarga
    
    Args:
        data: Datos de la solicitud
        
    Returns:
        (válido, mensaje_error)
    """
    # Verificar URL
    if 'url' not in data or not data['url']:
        return False, "URL no proporcionada"
    
    if not validate_url(data['url']):
        return False, "URL inválida"
    
    # Verificar tipo
    if 'tipo' in data and data['tipo'] not in ['video', 'audio']:
        return False, "Tipo inválido (debe ser 'video' o 'audio')"
    
    # Verificar título
    if 'titulo' in data and len(data['titulo']) > 500:
        return False, "Título demasiado largo"
    
    return True, None


def validate_search_query(query: str) -> tuple[bool, Optional[str]]:
    """
    Valida una consulta de búsqueda
    
    Args:
        query: Consulta a validar
        
    Returns:
        (válido, mensaje_error)
    """
    if not query or not query.strip():
        return False, "Consulta vacía"
    
    if len(query) > 200:
        return False, "Consulta demasiado larga"
    
    # Verificar caracteres sospechosos
    suspicious_chars = ['<', '>', '{', '}', '|', '^']
    if any(char in query for char in suspicious_chars):
        return False, "Consulta contiene caracteres inválidos"
    
    return True, None


# ==========================================
# CONVERSIÓN DE DATOS
# ==========================================
def bytes_to_mb(bytes_size: int) -> float:
    """
    Convierte bytes a megabytes
    
    Args:
        bytes_size: Tamaño en bytes
        
    Returns:
        Tamaño en MB
    """
    return round(bytes_size / (1024 * 1024), 2)


def mb_to_bytes(mb_size: float) -> int:
    """
    Convierte megabytes a bytes
    
    Args:
        mb_size: Tamaño en MB
        
    Returns:
        Tamaño en bytes
    """
    return int(mb_size * 1024 * 1024)


# ==========================================
# LOGGING HELPERS
# ==========================================
def log_download_start(task_id: str, url: str, tipo: str):
    """Registra inicio de descarga"""
    logger.info(f"[{task_id}] Descarga iniciada - URL: {url[:50]}... Tipo: {tipo}")


def log_download_progress(task_id: str, progress: int):
    """Registra progreso de descarga"""
    if progress % 25 == 0:  # Log cada 25%
        logger.info(f"[{task_id}] Progreso: {progress}%")


def log_download_complete(task_id: str, file_path: str):
    """Registra descarga completada"""
    size = get_file_size(Path(file_path))
    size_str = format_file_size(size) if size else "desconocido"
    logger.info(f"[{task_id}] Descarga completada - Archivo: {file_path} ({size_str})")


def log_download_error(task_id: str, error: str):
    """Registra error en descarga"""
    logger.error(f"[{task_id}] Error: {error}")


# ==========================================
# CONFIGURACIÓN
# ==========================================
class Config:
    """
    Configuración centralizada de la aplicación
    """
    # Directorios
    BASE_DIR = Path(__file__).parent
    DOWNLOADS_DIR = BASE_DIR / "downloads"
    TEMP_DIR = Path(os.environ.get('TEMP', '/tmp')) / "dynatube_web"
    
    # Base de datos
    DB_NAME = "history.db"
    
    # Límites
    MAX_FILE_SIZE_MB = 500
    MAX_DOWNLOAD_TIME_MINUTES = 30
    MAX_CONCURRENT_DOWNLOADS = 5
    
    # Rate limiting
    RATE_LIMIT_REQUESTS = 10
    RATE_LIMIT_WINDOW_SECONDS = 60
    
    # Limpieza
    CLEANUP_INTERVAL_HOURS = 1
    CLEANUP_AGE_HOURS = 24
    TEMP_CLEANUP_AGE_HOURS = 6
    
    # FFmpeg
    FFMPEG_TIMEOUT_SECONDS = 300
    
    @classmethod
    def init_directories(cls):
        """Inicializa directorios necesarios"""
        ensure_directory(cls.DOWNLOADS_DIR)
        ensure_directory(cls.TEMP_DIR)
        logger.info("Directorios inicializados")
    
    @classmethod
    def get_max_file_size_bytes(cls) -> int:
        """Obtiene tamaño máximo de archivo en bytes"""
        return mb_to_bytes(cls.MAX_FILE_SIZE_MB)


# ==========================================
# EXPORT
# ==========================================
__all__ = [
    'sanitize_filename',
    'validate_url',
    'validate_file_extension',
    'cleanup_old_files',
    'get_file_size',
    'format_file_size',
    'ensure_directory',
    'generate_cache_key',
    'generate_task_id',
    'format_duration',
    'parse_duration',
    'get_timestamp',
    'format_date',
    'RateLimiter',
    'validate_download_request',
    'validate_search_query',
    'bytes_to_mb',
    'mb_to_bytes',
    'log_download_start',
    'log_download_progress',
    'log_download_complete',
    'log_download_error',
    'Config'
]