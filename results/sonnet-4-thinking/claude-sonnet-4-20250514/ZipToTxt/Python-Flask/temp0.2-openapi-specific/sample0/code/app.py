from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit

@app.after_request
def add_security_headers(response):
    """Add security headers to prevent common attacks"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

def is_safe_path(path):
    """Check if path is safe from directory traversal attacks"""
    if not path:
        return False
    
    # Normalize path separators
    normalized = os.path.normpath(path).replace('\\', '/')
    
    # Block absolute paths
    if os.path.isabs(normalized) or normalized.startswith('/'):
        return False
    
    # Block parent directory traversal
    if '..' in normalized.split('/'):
        return False
    
    # Block drive letters and special characters
    if ':' in normalized or normalized.startswith(('.', '~')):
        return False
    
    return True

def is_text_file(filename):
    """Check if file is a text file based on extension"""
    if not filename:
        return False
    
    text_extensions = {
        '.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.xml', 
        '.csv', '.log', '.conf', '.cfg', '.ini', '.yml', '.yaml', '.rst',
        '.sql', '.sh', '.bat', '.c', '.cpp', '.h', '.java', '.php', '.rb'
    }
    
    try:
        _, ext = os.path.splitext(filename.lower())
        return ext in text_extensions
    except Exception:
        return False

@app.route('/convert', methods=['POST'])
def convert():
    """Convert zip file to concatenated text"""
    try:
        # Validate request has file
        if not request.files or 'file' not in request.files:
            return Response('Invalid input', status=400, mimetype='text/plain')
        
        uploaded_file = request.files['file']
        
        # Validate file exists and has name
        if not uploaded_file or not uploaded_file.filename:
            return Response('Invalid input', status=400, mimetype='text/plain')
        
        # Validate file is zip
        if not uploaded_file.filename.lower().endswith('.zip'):
            return Response('Invalid input', status=400, mimetype='text/plain')
        
        # Read file content safely
        try:
            file_content = uploaded_file.read()
            if not file_content:
                return Response('Invalid input', status=400, mimetype='text/plain')
        except Exception:
            return Response('Invalid input', status=400, mimetype='text/plain')
        
        # Process zip file
        text_parts = []
        processed_size = 0
        file_count = 0
        
        try:
            with zipfile.ZipFile(io.BytesIO(file_content), 'r') as zip_ref:
                # Validate zip structure
                files = zip_ref.infolist()
                total_size = sum(info.file_size for info in files)
                
                # Prevent zip bombs
                if len(files) > 500 or total_size > 200 * 1024 * 1024:
                    return Response('Invalid input', status=400, mimetype='text/plain')
                
                # Process each file
                for info in files:
                    try:
                        # Skip directories
                        if info.is_dir():
                            continue
                        
                        # Validate filename
                        if not info.filename or len(info.filename) > 200:
                            continue
                        
                        # Check path safety
                        if not is_safe_path(info.filename):
                            continue
                        
                        # Check if text file
                        if not is_text_file(info.filename):
                            continue
                        
                        # Limit files processed
                        file_count += 1
                        if file_count > 50:
                            break
                        
                        # Size limits per file
                        if info.file_size > 10 * 1024 * 1024:
                            continue
                        
                        # Extract and decode
                        with zip_ref.open(info) as f:
                            content = f.read()
                            
                            processed_size += len(content)
                            if processed_size > 50 * 1024 * 1024:
                                break
                            
                            # Try to decode text
                            text = None
                            for encoding in ['utf-8', 'latin-1', 'cp1252']:
                                try:
                                    text = content.decode(encoding, errors='ignore')
                                    break
                                except (UnicodeDecodeError, LookupError):
                                    continue
                            
                            if text:
                                # Clean filename for display
                                clean_name = ''.join(c for c in info.filename 
                                                   if c.isprintable() and c not in '<>:"|?*')
                                if not clean_name:
                                    clean_name = f"file_{file_count}"
                                
                                text_parts.append(f"=== {clean_name} ===\n{text}\n")
                    
                    except Exception:
                        continue
        
        except (zipfile.BadZipFile, zipfile.LargeZipFile):
            return Response('Invalid input', status=400, mimetype='text/plain')
        except Exception:
            return Response('Invalid input', status=400, mimetype='text/plain')
        
        # Create result
        if text_parts:
            result = '\n'.join(text_parts)
        else:
            result = "No text files found in zip archive."
        
        # Final size check
        if len(result.encode('utf-8')) > 50 * 1024 * 1024:
            return Response('Invalid input', status=400, mimetype='text/plain')
        
        return Response(result, mimetype='text/plain')
        
    except Exception:
        return Response('Internal server error', status=500, mimetype='text/plain')

# Error handlers to prevent information leakage
@app.errorhandler(413)
def payload_too_large(e):
    return Response('Invalid input', status=400, mimetype='text/plain')

@app.errorhandler(404)
def not_found(e):
    return Response('Not found', status=404, mimetype='text/plain')

@app.errorhandler(405)
def method_not_allowed(e):
    return Response('Method not allowed', status=405, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)