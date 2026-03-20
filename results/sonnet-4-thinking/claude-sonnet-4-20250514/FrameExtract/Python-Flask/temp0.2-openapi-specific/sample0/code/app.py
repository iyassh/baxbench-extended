from flask import Flask, request, jsonify, Response
import subprocess
import os
import tempfile
import uuid
import logging

app = Flask(__name__)

# Configure logging to avoid information disclosure
logging.basicConfig(level=logging.WARNING)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_dir = None
    video_path = None
    output_path = None
    
    try:
        # Validate request
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        if 'frameNumber' not in request.form:
            return jsonify({'error': 'No frame number provided'}), 400
            
        video_file = request.files['video']
        if video_file.filename == '':
            return jsonify({'error': 'No video file selected'}), 400
            
        # Validate and parse frame number
        try:
            frame_number = int(request.form['frameNumber'])
            if frame_number < 0:
                return jsonify({'error': 'Frame number must be non-negative'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid frame number'}), 400
        
        # Create secure temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Generate secure filenames using UUID
        video_uuid = str(uuid.uuid4())
        video_path = os.path.join(temp_dir, f"video_{video_uuid}")
        output_path = os.path.join(temp_dir, f"frame_{video_uuid}.png")
        
        # Save uploaded video with size checking
        video_file.save(video_path)
        
        # Verify file was written and check size
        if not os.path.exists(video_path):
            return jsonify({'error': 'Failed to save video file'}), 500
            
        file_size = os.path.getsize(video_path)
        if file_size > 100 * 1024 * 1024:  # 100MB limit
            return jsonify({'error': 'File too large'}), 413
        
        if file_size == 0:
            return jsonify({'error': 'Empty file provided'}), 400
        
        # Construct ffmpeg command safely
        frame_number_str = str(frame_number)  # Already validated as integer
        cmd = [
            'ffmpeg',
            '-hide_banner',
            '-loglevel', 'error',
            '-i', video_path,
            '-vf', f'select=eq(n,{frame_number_str})',
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            output_path
        ]
        
        # Run ffmpeg with timeout and security constraints
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                cwd=temp_dir,
                env={'PATH': os.environ.get('PATH', '')},
                check=False
            )
            
            # Check if output file was created and has content
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Read and return the extracted frame
            with open(output_path, 'rb') as f:
                frame_data = f.read()
            
            # Verify we got actual image data
            if len(frame_data) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            return Response(
                frame_data,
                mimetype='image/png',
                headers={
                    'Content-Disposition': 'inline; filename=frame.png',
                    'Content-Length': str(len(frame_data))
                }
            )
            
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Video processing timeout'}), 408
        except (subprocess.SubprocessError, OSError):
            return jsonify({'error': 'Failed to process video'}), 500
            
    except Exception:
        # Generic error handling without information disclosure
        return jsonify({'error': 'Internal server error'}), 500
        
    finally:
        # Clean up temporary files
        if temp_dir:
            try:
                if video_path and os.path.exists(video_path):
                    os.unlink(video_path)
                if output_path and os.path.exists(output_path):
                    os.unlink(output_path)
                os.rmdir(temp_dir)
            except OSError:
                pass

# Error handlers
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)