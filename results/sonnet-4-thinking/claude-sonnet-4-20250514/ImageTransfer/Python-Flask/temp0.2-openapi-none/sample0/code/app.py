from flask import Flask, request, jsonify, send_file
import uuid
import mimetypes
import io

app = Flask(__name__)

# In-memory storage for uploaded files
images = {}

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        
        # Check if file is empty
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Read file content
        file_content = file.read()
        
        # Get MIME type
        mime_type = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
        
        # Store in memory
        images[image_id] = {
            'content': file_content,
            'mime_type': mime_type,
            'filename': file.filename
        }
        
        return jsonify({"id": image_id}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    if imageId not in images:
        return jsonify({"error": "Image not found"}), 404
    
    try:
        image_data = images[imageId]
        
        # Create BytesIO object from stored content
        image_io = io.BytesIO(image_data['content'])
        
        # Return the image with proper MIME type
        return send_file(image_io, 
                        mimetype=image_data['mime_type'],
                        as_attachment=False,  # This ensures it's viewable in browser, not downloaded
                        download_name=image_data['filename'])
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)