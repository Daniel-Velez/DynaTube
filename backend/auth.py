"""
Sistema de Autenticación para Dynatube Pro
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token, 
    create_refresh_token,
    jwt_required, 
    get_jwt_identity,
    get_jwt
)
import bcrypt
import hashlib
import psycopg2
from datetime import datetime, timedelta
from contextlib import contextmanager
import os
from dotenv import load_dotenv

load_dotenv()

auth_bp = Blueprint('auth', __name__)

# Configuración de DB
DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'admin'),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5432')
}

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


# ==========================================
# UTILIDADES
# ==========================================
def hash_password(password: str) -> str:
    """Hashea una contraseña usando bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """Verifica una contraseña contra su hash"""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def get_user_by_username(username: str):
    """Obtiene un usuario por nombre de usuario"""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, username, email, password_hash, full_name, 
                           avatar_url, is_active, is_admin, created_at
                    FROM users 
                    WHERE username = %s
                    """,
                    (username,)
                )
                result = cur.fetchone()
                
                if result:
                    # El orden aquí debe coincidir con el orden del SELECT arriba
                    return {
                        'id': result[0],
                        'username': result[1],
                        'email': result[2],
                        'password_hash': result[3],
                        'full_name': result[4],
                        'avatar_url': result[5],
                        'is_active': result[6],
                        'is_admin': result[7],
                        'created_at': result[8].isoformat() if hasattr(result[8], 'isoformat') else str(result[8])
                    }
                return None
    except Exception as e:
        print(f"❌ Error al obtener usuario: {e}")
        return None


def get_user_by_email(email: str):
    """Obtiene un usuario por email"""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, email, password_hash, full_name, 
                       avatar_url, is_active, is_admin, created_at
                FROM users 
                WHERE email = %s
                """,
                (email,)
            )
            result = cur.fetchone()
            if result:
                return {
                    'id': result[0],
                    'username': result[1],
                    'email': result[2],
                    'password_hash': result[3],
                    'full_name': result[4],
                    'avatar_url': result[5],
                    'is_active': result[6],
                    'is_admin': result[7],
                    'created_at': result[8].isoformat() if result[8] else None
                }
            return None


def update_last_login(user_id: int):
    """Actualiza la última fecha de login"""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = %s",
                (user_id,)
            )


def create_session(user_id: int, token: str, ip: str, user_agent: str):
    """Crea una sesión en la base de datos usando SHA-256"""
    # Reemplazamos bcrypt por SHA-256 para evitar el límite de 72 caracteres
    token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
    expires_at = datetime.now() + timedelta(days=30)
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (user_id, token_hash, ip, user_agent, expires_at)
            )


# ==========================================
# ENDPOINTS DE AUTENTICACIÓN
# ==========================================
@auth_bp.route('/register', methods=['POST'])
def register():
    """Registro de nuevos usuarios"""
    data = request.json
    
    # Validaciones
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    full_name = data.get('full_name', '').strip()
    
    if not username or not email or not password:
        return jsonify({'error': 'Datos incompletos'}), 400
    
    if len(username) < 3:
        return jsonify({'error': 'El usuario debe tener al menos 3 caracteres'}), 400
    
    if len(password) < 6:
        return jsonify({'error': 'La contraseña debe tener al menos 6 caracteres'}), 400
    
    # Verificar si el usuario ya existe
    if get_user_by_username(username):
        return jsonify({'error': 'El nombre de usuario ya existe'}), 409
    
    if get_user_by_email(email):
        return jsonify({'error': 'El email ya está registrado'}), 409
    
    # Crear usuario
    password_hash = hash_password(password)
    
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (username, email, password_hash, full_name)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, username, email, full_name, created_at
                    """,
                    (username, email, password_hash, full_name)
                )
                result = cur.fetchone()
                
                user_data = {
                    'id': result[0],
                    'username': result[1],
                    'email': result[2],
                    'full_name': result[3],
                    'created_at': result[4].isoformat()
                }
        
        return jsonify({
            'message': 'Usuario creado exitosamente',
            'user': user_data
        }), 201
        
    except Exception as e:
        return jsonify({'error': f'Error al crear usuario: {str(e)}'}), 500


@auth_bp.route('/login', methods=['POST'])
def login():
    """Inicio de sesión con sistema de diagnóstico (Debug)"""
    data = request.json
    
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    print(f"\n--- INTENTO DE LOGIN: '{username}' ---")
    
    if not username or not password:
        return jsonify({'error': 'Credenciales incompletas'}), 400
    
    # Buscar usuario (puede ser username o email)
    user = get_user_by_username(username)
    if not user:
        user = get_user_by_email(username)
    
    if not user:
        print("❌ ERROR: El usuario no existe en la base de datos.")
        return jsonify({'error': 'Credenciales inválidas'}), 401
        
    print(f"✅ Usuario encontrado: ID {user['id']} | Nombre: {user['username']}")
    
    # Verificar si está activo
    if not user['is_active']:
        print("❌ ERROR: La cuenta está desactivada.")
        return jsonify({'error': 'Cuenta desactivada'}), 403
    
    # Verificar contraseña
    if not verify_password(password, user['password_hash']):
        print("❌ ERROR: La contraseña es incorrecta (El hash no coincide).")
        return jsonify({'error': 'Credenciales inválidas'}), 401
        
    print("✅ Contraseña correcta. Generando tokens de acceso...")
    
# Crear tokens
    access_token = create_access_token(
        identity=str(user['id']), # Convertimos a string para evitar el 422
        additional_claims={
            'username': user['username'],
            'is_admin': user['is_admin']
        }
    )
    
    refresh_token = create_refresh_token(identity=user['id'])
    
    # Actualizar último login
    update_last_login(user['id'])
    
    # Crear sesión
    ip_address = request.remote_addr
    user_agent = request.headers.get('User-Agent', '')
    create_session(user['id'], access_token, ip_address, user_agent)
    
    # Preparar respuesta
    user_response = {
        'id': user['id'],
        'username': user['username'],
        'email': user['email'],
        'full_name': user['full_name'],
        'avatar_url': user['avatar_url'],
        'is_admin': user['is_admin']
    }
    
    return jsonify({
        'message': 'Login exitoso',
        'access_token': access_token,
        'refresh_token': refresh_token,
        'user': user_response
    }), 200


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Renovar token de acceso"""
    current_user_id = get_jwt_identity()
    
    # Obtener información del usuario
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, is_admin FROM users WHERE id = %s",
                (current_user_id,)
            )
            result = cur.fetchone()
            
            if not result:
                return jsonify({'error': 'Usuario no encontrado'}), 404
    
    # Crear nuevo access token
    access_token = create_access_token(
        identity=current_user_id,
        additional_claims={
            'username': result[0],
            'is_admin': result[1]
        }
    )
    
    return jsonify({'access_token': access_token}), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Obtener información del usuario actual"""
    current_user_id = get_jwt_identity()
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, email, full_name, avatar_url, 
                       is_admin, created_at, last_login
                FROM users 
                WHERE id = %s
                """,
                (current_user_id,)
            )
            result = cur.fetchone()
            
            if not result:
                return jsonify({'error': 'Usuario no encontrado'}), 404
            
            user_data = {
                'id': result[0],
                'username': result[1],
                'email': result[2],
                'full_name': result[3],
                'avatar_url': result[4],
                'is_admin': result[5],
                'created_at': result[6].isoformat() if result[6] else None,
                'last_login': result[7].isoformat() if result[7] else None
            }
    
    return jsonify({'user': user_data}), 200


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """Cerrar sesión (invalida el token)"""
    # En producción, aquí invalidarías el token en la tabla sessions
    return jsonify({'message': 'Sesión cerrada exitosamente'}), 200


@auth_bp.route('/change-password', methods=['POST'])
@jwt_required()
def change_password():
    """Cambiar contraseña"""
    current_user_id = get_jwt_identity()
    data = request.json
    
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    
    if not current_password or not new_password:
        return jsonify({'error': 'Datos incompletos'}), 400
    
    if len(new_password) < 6:
        return jsonify({'error': 'La nueva contraseña debe tener al menos 6 caracteres'}), 400
    
    # Obtener usuario
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password_hash FROM users WHERE id = %s",
                (current_user_id,)
            )
            result = cur.fetchone()
            
            if not result:
                return jsonify({'error': 'Usuario no encontrado'}), 404
            
            # Verificar contraseña actual
            if not verify_password(current_password, result[0]):
                return jsonify({'error': 'Contraseña actual incorrecta'}), 401
            
            # Actualizar contraseña
            new_hash = hash_password(new_password)
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (new_hash, current_user_id)
            )
    
    return jsonify({'message': 'Contraseña actualizada exitosamente'}), 200