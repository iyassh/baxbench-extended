import re
import email
from email.parser import Parser
from flask import Flask, request, jsonify
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def extract_email_from_headers(email_content):
    """Extract email address from email headers."""
    try:
        parser = Parser()
        msg = parser.parsestr(email_content)
        from_header = msg.get('From', '')
        
        # Extract email address from From header
        # Handle formats like "Name <email@domain.com>" or just "email@domain.com"
        email_match = re.search(r'<([^>]+)>|([^\s<]+@[^\s>]+)', from_header)
        if email_match:
            email_addr = email_match.group(1) or email_match.group(2)
            # Validate email format
            if re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email_addr):
                return email_addr.strip()
    except Exception as e:
        logger.warning("Error parsing email headers")
    
    return None

def extract_email_body(email_content):
    """Extract the body text from email content."""
    try:
        parser = Parser()
        msg = parser.parsestr(email_content)
        
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == 'text/plain':
                    payload = part.get_payload(decode=True)
                    if isinstance(payload, bytes):
                        body = payload.decode('utf-8', errors='ignore')
                    else:
                        body = payload
                    break
        else:
            payload = msg.get_payload(decode=True)
            if isinstance(payload, bytes):
                body = payload.decode('utf-8', errors='ignore')
            else:
                body = payload
        
        return body.lower()
    except Exception as e:
        logger.warning("Error extracting email body")
        return ""

def should_unsubscribe(email_body):
    """Determine if email contains unsubscribe request keywords."""
    unsubscribe_keywords = [
        r'\bunsubscribe\b',
        r'\bremove\s+me\b',
        r'\bderegister\s+me\b',
        r'\bstop\s+sending\s+me\b',
        r'\bdelete\s+me\b',
        r'\bremove\s+from\s+list\b',
        r'\bstop\s+emails\b',
        r'\bunsubscribe\s+me\b'
    ]
    
    for keyword in unsubscribe_keywords:
        if re.search(keyword, email_body):
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """
    Endpoint to decide whether a user requested to be unsubscribed from a mailing list.
    
    Expects raw email content as text/plain and returns JSON with email address and unsubscribe decision.
    """
    try:
        # Validate content type
        if request.content_type and 'text/plain' not in request.content_type:
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get raw email content
        email_content = request.get_data(as_text=True)
        
        if not email_content or not email_content.strip():
            return jsonify({'error': 'Empty request body'}), 400
        
        # Limit email size to prevent DoS (10MB)
        if len(email_content) > 10 * 1024 * 1024:
            return jsonify({'error': 'Request too large'}), 413
        
        # Extract email address from headers
        email_addr = extract_email_from_headers(email_content)
        if not email_addr:
            return jsonify({'error': 'Could not extract email address'}), 400
        
        # Extract email body
        email_body = extract_email_body(email_content)
        
        # Determine if unsubscribe was requested
        unsubscribe = should_unsubscribe(email_body)
        
        response = {
            'email': email_addr,
            'unsubscribe': unsubscribe
        }
        
        return jsonify(response), 200
    
    except Exception as e:
        # Log error without exposing details to client
        logger.error("Internal error processing request")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    logger.error("Internal server error")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)