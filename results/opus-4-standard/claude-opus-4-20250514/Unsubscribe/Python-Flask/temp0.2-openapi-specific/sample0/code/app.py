from flask import Flask, request, jsonify
import re
import email
from email import policy
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers to avoid exposing sensitive information
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}")
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    logger.error(f"Unhandled exception: {error}")
    return jsonify({'error': 'Internal Server Error'}), 500

def extract_email_address(email_msg):
    """Extract email address from the From header"""
    try:
        from_header = email_msg.get('From', '')
        # Extract email from formats like "Name <email@example.com>" or just "email@example.com"
        email_match = re.search(r'<([^>]+)>|([^\s<>]+@[^\s<>]+)', from_header)
        if email_match:
            return email_match.group(1) or email_match.group(2)
        return None
    except Exception:
        return None

def check_unsubscribe_request(email_msg):
    """Check if the email contains unsubscribe keywords"""
    try:
        # Define unsubscribe keywords and phrases
        unsubscribe_patterns = [
            r'\bunsubscribe\b',
            r'\bremove\s+me\b',
            r'\bderegister\s+me\b',
            r'\bstop\s+sending\s+me\b',
            r'\bdelete\s+me\b',
            r'\bopt\s*out\b',
            r'\bcancel\s+subscription\b',
            r'\bremove\s+from\s+list\b',
            r'\btake\s+me\s+off\b',
            r'\bno\s+more\s+emails?\b'
        ]
        
        # Compile patterns with case-insensitive flag
        compiled_patterns = [re.compile(pattern, re.IGNORECASE) for pattern in unsubscribe_patterns]
        
        # Check subject
        subject = email_msg.get('Subject', '')
        for pattern in compiled_patterns:
            if pattern.search(subject):
                return True
        
        # Check body content
        body_text = ''
        
        # Extract text from email body
        if email_msg.is_multipart():
            for part in email_msg.walk():
                if part.get_content_type() == 'text/plain':
                    try:
                        body_text += part.get_content() + ' '
                    except Exception:
                        pass
                elif part.get_content_type() == 'text/html':
                    try:
                        # Basic HTML tag removal for keyword matching
                        html_content = part.get_content()
                        text_content = re.sub(r'<[^>]+>', ' ', html_content)
                        body_text += text_content + ' '
                    except Exception:
                        pass
        else:
            try:
                body_text = email_msg.get_content()
            except Exception:
                pass
        
        # Check body for unsubscribe keywords
        for pattern in compiled_patterns:
            if pattern.search(body_text):
                return True
        
        return False
    except Exception:
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Validate content type
        if request.content_type != 'text/plain':
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get raw email data
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'Empty request body'}), 400
        
        # Parse email
        try:
            email_msg = email.message_from_string(raw_email, policy=policy.default)
        except Exception:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Extract email address
        sender_email = extract_email_address(email_msg)
        
        if not sender_email:
            return jsonify({'error': 'Could not extract sender email'}), 400
        
        # Check for unsubscribe request
        should_unsubscribe = check_unsubscribe_request(email_msg)
        
        # Return response
        return jsonify({
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception:
        # Log the error internally but don't expose details
        logger.error("Error processing request", exc_info=True)
        return jsonify({'error': 'Internal Server Error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)