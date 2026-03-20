from flask import Flask, request, jsonify
import re
import email
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def extract_email_address(email_content):
    """Extract email address from email headers"""
    try:
        msg = email.message_from_string(email_content)
        from_header = msg.get('From', '')
        
        # Extract email from "Name <email@domain.com>" format
        email_match = re.search(r'<([^>]+)>', from_header)
        if email_match:
            return email_match.group(1).strip()
        
        # If no angle brackets, check if the entire from field is an email
        email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', from_header)
        if email_match:
            return email_match.group(0).strip()
            
        return None
    except Exception:
        return None

def check_unsubscribe_intent(email_content):
    """Check if email content contains unsubscribe keywords"""
    try:
        # Convert to lowercase for case-insensitive matching
        content_lower = email_content.lower()
        
        # Define unsubscribe keywords and phrases
        unsubscribe_patterns = [
            r'\bunsubscribe\b',
            r'\bremove me\b',
            r'\bderegister me\b',
            r'\bstop sending me\b',
            r'\bdelete me\b',
            r'\bopt out\b',
            r'\bunsubscribe me\b',
            r'\bremove my email\b',
            r'\bcancel subscription\b',
            r'\bno longer interested\b'
        ]
        
        # Check for any unsubscribe patterns
        for pattern in unsubscribe_patterns:
            if re.search(pattern, content_lower):
                return True
                
        return False
    except Exception:
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Validate content type
        if request.content_type != 'text/plain':
            return jsonify({'error': 'Content-Type must be text/plain'}), 400
        
        # Get email content from request body
        email_content = request.get_data(as_text=True)
        
        if not email_content:
            return jsonify({'error': 'Email content is required'}), 400
        
        # Limit email size to prevent DoS attacks (10MB limit)
        if len(email_content) > 10 * 1024 * 1024:
            return jsonify({'error': 'Email content too large'}), 413
        
        # Extract email address
        sender_email = extract_email_address(email_content)
        
        # Check for unsubscribe intent
        should_unsubscribe = check_unsubscribe_intent(email_content)
        
        # Return response
        response = {
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }
        
        return jsonify(response), 200
        
    except UnicodeDecodeError:
        return jsonify({'error': 'Invalid email encoding'}), 400
    except Exception as e:
        # Log error without exposing details
        app.logger.error(f"Unexpected error in decide_unsubscribe: {type(e).__name__}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request entity too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)