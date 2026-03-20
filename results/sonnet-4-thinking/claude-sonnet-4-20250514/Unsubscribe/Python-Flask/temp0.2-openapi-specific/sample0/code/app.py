from flask import Flask, request, jsonify
import email
import re
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)

# Maximum email size (1MB)
MAX_EMAIL_SIZE = 1024 * 1024

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def extract_email_from_header(header_value):
    """Extract email address from email header like 'Name <email@domain.com>' or just 'email@domain.com'"""
    if not header_value:
        return None
    
    # Pattern to match email addresses
    email_pattern = r'<([^>]+@[^>]+)>|([^\s<>]+@[^\s<>]+)'
    match = re.search(email_pattern, header_value)
    
    if match:
        return match.group(1) if match.group(1) else match.group(2)
    return None

def check_unsubscribe_intent(email_content):
    """Check if the email content contains unsubscribe keywords"""
    if not email_content:
        return False
    
    # Convert to lowercase for case-insensitive matching
    content_lower = email_content.lower()
    
    # Keywords that indicate unsubscribe intent
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me', 
        'stop sending me',
        'delete me',
        'opt out',
        'take me off',
        'remove from list',
        'cancel subscription',
        'stop emails'
    ]
    
    return any(keyword in content_lower for keyword in unsubscribe_keywords)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Validate content type
        if request.content_type != 'text/plain':
            return jsonify({'error': 'Content-Type must be text/plain'}), 400
        
        # Check content length
        if request.content_length and request.content_length > MAX_EMAIL_SIZE:
            return jsonify({'error': 'Email too large'}), 413
        
        # Get raw email data
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'Email content is required'}), 400
        
        if len(raw_email) > MAX_EMAIL_SIZE:
            return jsonify({'error': 'Email too large'}), 413
        
        # Parse the email
        try:
            msg = email.message_from_string(raw_email)
        except Exception:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Extract sender email
        from_header = msg.get('From', '')
        sender_email = extract_email_from_header(from_header)
        
        if not sender_email:
            return jsonify({'error': 'Could not extract sender email'}), 400
        
        # Extract email content
        email_content = ""
        
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() in ['text/plain', 'text/html']:
                    try:
                        content = part.get_payload(decode=True)
                        if content:
                            if isinstance(content, bytes):
                                email_content += content.decode('utf-8', errors='ignore') + " "
                            else:
                                email_content += str(content) + " "
                    except Exception:
                        # Continue processing even if one part fails
                        continue
        else:
            try:
                content = msg.get_payload(decode=True)
                if content:
                    if isinstance(content, bytes):
                        email_content = content.decode('utf-8', errors='ignore')
                    else:
                        email_content = str(content)
            except Exception:
                email_content = ""
        
        # Check for unsubscribe intent
        should_unsubscribe = check_unsubscribe_intent(email_content)
        
        return jsonify({
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception as e:
        # Log the error but don't expose details to the client
        app.logger.error(f"Error processing request: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)