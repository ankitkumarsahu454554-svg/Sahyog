"""
SahyogAI Disaster Management Platform - Production Entrypoint for Vercel
Serves the Brahmapur, Odisha Crisis Portal.
"""
import os
import mimetypes
from pathlib import Path

def app(environ, start_response):
    raw_path = environ.get('PATH_INFO', '/').lstrip('/')
    if not raw_path:
        raw_path = 'index.html'

    base_dir = Path(__file__).parent
    candidates = [
        base_dir / 'public' / raw_path,
        base_dir / raw_path,
        base_dir / 'client' / 'public' / raw_path,
        base_dir / 'public' / 'index.html',
        base_dir / 'index.html'
    ]

    file_path = next((c for c in candidates if c.is_file()), base_dir / 'public' / 'index.html')

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
        headers = [('Content-Type', 'text/plain; charset=utf-8')]
        start_response(status, headers)
        return [f"Server Error: {str(e)}".encode('utf-8')]

application = app
