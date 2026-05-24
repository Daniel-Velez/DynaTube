// ==========================================
// AUTHENTICATION MANAGER
// ==========================================

class AuthManager {
    constructor() {
        this.accessToken = localStorage.getItem('access_token');
        this.refreshToken = localStorage.getItem('refresh_token');
        try {
            const userStr = localStorage.getItem('user');
            this.currentUser = (userStr && userStr !== 'undefined') ? JSON.parse(userStr) : null;
        } catch (e) {
            this.currentUser = null;
            localStorage.removeItem('user');
        }
        this.API_BASE = window.location.origin;
    }

    /**
     * Verifica si el usuario está autenticado
     */
    isAuthenticated() {
        return !!this.accessToken && !!this.currentUser;
    }

    /**
     * Obtiene el token de acceso actual
     */
    getAccessToken() {
        return this.accessToken;
    }

    /**
     * Obtiene el usuario actual
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Login de usuario
     */
    async login(username, password) {
        try {
            const response = await fetch(`${this.API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error en login');
            }

            // Guardar tokens y usuario
            this.accessToken = data.access_token;
            this.refreshToken = data.refresh_token;
            this.currentUser = data.user;

            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            localStorage.setItem('user', JSON.stringify(data.user));

            return { success: true, user: data.user };
        } catch (error) {
            console.error('Error en login:', error);
            throw error;
        }
    }

    /**
     * Registro de nuevo usuario
     */
    async register(username, email, password, fullName) {
        try {
            const response = await fetch(`${this.API_BASE}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    email,
                    password,
                    full_name: fullName
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error en registro');
            }

            return { success: true, user: data.user };
        } catch (error) {
            console.error('Error en registro:', error);
            throw error;
        }
    }

    /**
     * Cerrar sesión
     */
    async logout() {
        try {
            if (this.accessToken) {
                await fetch(`${this.API_BASE}/api/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                });
            }
        } catch (error) {
            console.error('Error en logout:', error);
        } finally {
            // Limpiar datos locales siempre
            this.accessToken = null;
            this.refreshToken = null;
            this.currentUser = null;

            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('user');
        }
    }

    /**
     * Renovar token de acceso
     */
    async refreshAccessToken() {
        try {
            const response = await fetch(`${this.API_BASE}/api/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.refreshToken}`
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error('Token refresh failed');
            }

            this.accessToken = data.access_token;
            localStorage.setItem('access_token', data.access_token);

            return data.access_token;
        } catch (error) {
            console.error('Error renovando token:', error);
            // Si falla, cerrar sesión
            await this.logout();
            throw error;
        }
    }

    /**
     * Obtener información del usuario actual
     */
    async fetchCurrentUser() {
        try {
            const response = await fetch(`${this.API_BASE}/api/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error('Error obteniendo usuario');
            }

            this.currentUser = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));

            return data.user;
        } catch (error) {
            console.error('Error obteniendo usuario:', error);
            throw error;
        }
    }

    /**
     * Cambiar contraseña
     */
    async changePassword(currentPassword, newPassword) {
        try {
            const response = await fetch(`${this.API_BASE}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken}`
                },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error cambiando contraseña');
            }

            return { success: true };
        } catch (error) {
            console.error('Error cambiando contraseña:', error);
            throw error;
        }
    }

    /**
     * Interceptor para agregar token a las peticiones
     */
    async fetchWithAuth(url, options = {}) {
        if (!options.headers) {
            options.headers = {};
        }

        if (this.accessToken) {
            options.headers['Authorization'] = `Bearer ${this.accessToken}`;
        }

        let response = await fetch(url, options);

        // Si el token expiró, intentar renovarlo
        if (response.status === 401 && this.refreshToken) {
            try {
                await this.refreshAccessToken();
                options.headers['Authorization'] = `Bearer ${this.accessToken}`;
                response = await fetch(url, options);
            } catch (error) {
                // Si falla el refresh, redirigir a login
                window.location.href = '#login';
                throw error;
            }
        }

        return response;
    }
}

// Instancia global
const authManager = new AuthManager();