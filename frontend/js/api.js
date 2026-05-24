// ==========================================
// API CLIENT - Comunicación con el Backend
// ==========================================

const API_BASE_URL = window.location.origin;

class DynatubeAPI {
    constructor(baseURL = API_BASE_URL) {
        this.baseURL = baseURL;
    }

    /**
     * Fetch con autenticación
     */
    async fetchWithAuth(url, options = {}) {
        const token = localStorage.getItem('access_token');
        
        if (token) {
            options.headers = {
                ...options.headers,
                'Authorization': 'Bearer ' + token.replace(/"/g, '')
            };
        }
        
        return await fetch(url, options);
    }

    /**
     * Manejo genérico de errores
     */
    async handleResponse(response) {
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        return response.json();
    }

    /**
     * Buscar videos en YouTube
     */
    async searchVideos(query, startIndex = 0) {
        try {
            const response = await fetch(`${this.baseURL}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, start_index: startIndex })
            });

            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error en búsqueda:', error);
            throw error;
        }
    }

    /**
     * Obtener calidades disponibles para un video
     */
    async getQualities(videoUrl) {
        try {
            const encodedUrl = encodeURIComponent(videoUrl);
            const response = await fetch(`${this.baseURL}/api/qualities?url=${encodedUrl}`);

            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error obteniendo calidades:', error);
            throw error;
        }
    }

    /**
     * Iniciar descarga de video/audio
     */
    async startDownload(url, tipo = 'video', formatId = null, titulo = 'video') {
        try {
            const response = await this.fetchWithAuth(`${this.baseURL}/api/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    tipo,
                    format_id: formatId,
                    titulo
                })
            });

            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error iniciando descarga:', error);
            throw error;
        }
    }

    /**
     * Obtener estado de una tarea
     */
    async getTaskStatus(taskId) {
        try {
            const response = await fetch(`${this.baseURL}/api/task/${taskId}`);
            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error obteniendo estado:', error);
            throw error;
        }
    }

    /**
     * Descargar archivo completado
     */
    downloadFile(taskId, filename) {
        const url = `${this.baseURL}/api/download/${taskId}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /**
     * Cancelar/eliminar tarea
     */
    async cancelTask(taskId) {
        try {
            const response = await fetch(`${this.baseURL}/api/task/${taskId}`, {
                method: 'DELETE'
            });

            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error cancelando tarea:', error);
            throw error;
        }
    }

    /**
     * Convertir video a MP3
     */
    async convertToMP3(file, onProgress = null) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();

            return new Promise((resolve, reject) => {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable && onProgress) {
                        const progress = (e.loaded / e.total) * 100;
                        onProgress(progress);
                    }
                });

                xhr.addEventListener('load', () => {
                    if (xhr.status === 200) {
                        const blob = xhr.response;
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = file.name.replace(/\.[^/.]+$/, '') + '.mp3';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                        resolve({ success: true });
                    } else {
                        reject(new Error(`Error ${xhr.status}`));
                    }
                });

                xhr.addEventListener('error', () => {
                    reject(new Error('Error de red'));
                });

                xhr.responseType = 'blob';
                xhr.open('POST', `${this.baseURL}/api/convert`);
                xhr.send(formData);
            });
        } catch (error) {
            console.error('Error en conversión:', error);
            throw error;
        }
    }

    /**
     * Obtener historial de descargas
     */
    async getHistory(limit = 100) {
        try {
            const token = localStorage.getItem('access_token');

            if (!token) throw new Error("Sesión expirada");

            const response = await fetch(`${this.baseURL}/api/history?limit=${limit}`, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token.replace(/"/g, ''),
                    'Content-Type': 'application/json'
                }
            });

            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error obteniendo historial:', error);
            throw error;
        }
    }

    /**
     * Limpiar historial
     */
    async clearHistory() {
        try {
            const response = await fetch(`${this.baseURL}/api/history`, {
                method: 'DELETE'
            });

            return await this.handleResponse(response);
        } catch (error) {
            console.error('Error limpiando historial:', error);
            throw error;
        }
    }
}

// Exportar instancia global
const api = new DynatubeAPI();