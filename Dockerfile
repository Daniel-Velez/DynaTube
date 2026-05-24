# Usamos una imagen base ligera de Python 3.12
FROM python:3.12-slim

# 1. Instalar dependencias del sistema necesarias
# Incluimos python3-setuptools para asegurar que pkg_resources esté disponible
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    ffmpeg \
    python3-setuptools \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# 2. Establecer el directorio de trabajo
WORKDIR /app

# 3. Instalar dependencias de Python
# Actualizamos pip y forzamos la instalación de setuptools
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools && \
    pip install --no-cache-dir -r requirements.txt

# 4. Crear un usuario no root por seguridad
RUN groupadd -r dynatube && useradd -r -g dynatube dynatube
RUN chown -R dynatube:dynatube /app

# 5. Copiar el resto del código fuente
COPY . .

# 6. Cambiar al usuario no root
USER dynatube

# 7. Exponer el puerto
EXPOSE 5000

# 8. Comando para iniciar usando el módulo de Python directamente
# Esto soluciona el problema de ruta con gunicorn
CMD ["python", "-m", "gunicorn", "--bind", "0.0.0.0:5000", "backend.app:app"]