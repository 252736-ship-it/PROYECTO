import http.server
import socketserver

PORT = 8000

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    '.js': 'application/javascript',
})

print(f"Iniciando servidor en el puerto {PORT}...")
print(f"Abre tu navegador y ve a: http://localhost:{PORT}")
print("Presiona Ctrl+C para detener el servidor")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()