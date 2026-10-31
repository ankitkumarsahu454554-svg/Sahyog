"""
SahyogAI Disaster Management Platform - Python Entrypoint Fallback for Vercel
Serves the Brahmapur, Odisha Crisis Portal if Vercel is configured with Python / FastAPI preset.
"""
import os
import mimetypes
from pathlib import Path

def app(environ, start_response):
    path = environ.get('PATH_INFO', '/').lstrip('/')
    if not path or path == 'index.html':
        file_path = Path(__file__).parent / 'index.html'
    else:
        candidates = [
            Path(__file__).parent / path,
            Path(__file__).parent / 'client' / 'public' / path,
            Path(__file__).parent / 'public' / path,
        ]
        file_path = next((c for c in candidates if c.is_file()), Path(__file__).parent / 'index.html')

    if not file_path.exists():
        file_path = Path(__file__).parent / 'index.html'

    mime_type, _ = mimetypes.guess_type(str(file_path))
    if not mime_type:
        mime_type = 'text/html' if file_path.suffix == '.html' else 'application/octet-stream'

    try:
        content = file_path.read_bytes()
        status = '200 OK'
        headers = [
            ('Content-Type', f'{mime_type}; charset=utf-8' if 'text' in mime_type or 'json' in mime_type else mime_type),
            ('Content-Length', str(len(content))),
            ('Cache-Control', 'public, max-age=0, must-revalidate')
        ]
        start_response(status, headers)
        return [content]
    except Exception as e:
        status = '500 Internal Server Error'
        headers = [('Content-Type', 'text/plain')]
        start_response(status, headers)
        return [f"Error loading file: {str(e)}".encode('utf-8')]

application = app

