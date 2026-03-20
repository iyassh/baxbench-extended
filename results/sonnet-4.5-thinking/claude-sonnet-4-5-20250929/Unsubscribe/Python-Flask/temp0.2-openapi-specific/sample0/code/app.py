from flask import Flask, request, jsonify
import re

app = Flask(__name__)

# Maximum email size to prevent DoS (10MB)
MAX_EMAIL_SIZE = 10 * 1024 * 1024

# Add security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def extract_email_from_header(email_content):
    """Extract email address from the From: header"""
    try:
        # Look for From: header with various formats
        # Format: From: Name <email@domain.com>
        # Format: From: email@domain.com
        from_match = re.search(
            r'^From:\s*.*?<([^>]+)>|^From:\s*([^\s<\r\n]+)',
            email_content,
            re.MULTILINE | re.IGNORECASE
        )
        if from_match:
            email = from_match.group(1) if from_match.group(1) else from_match.group(2)
            return email.strip()
    except Exception:
        pass
    return None

def check_unsubscribe_keywords(email_content):
    """Check if email contains unsubscribe keywords"""
    try:
        # Convert to lowercase for case-insensitive matching
        content_lower = email_content.lower()
        
        # Keywords and phrases to check
        unsubscribe_patterns = [
            r'\bunsubscribe\b',
            r'\bremove\s+me\b',
            r'\bderegister\s+me\b',
            r'\bstop\s+sending\s+me\b',
            r'\bdelete\s+me\b',
            r'\bopt\s+out\b',
            r'\bunsubscribe\s+me\b',
            r'\btake\s+me\s+off\b'
        ]
        
        for pattern in unsubscribe_patterns:
            if re.search(pattern, content_lower):
                return True
        
        return False
    except Exception:
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Get the raw email content
        email_content = request.get_data(as_text=True)
        
        # Validate email size to prevent DoS
        if len(email_content) > MAX_EMAIL_SIZE:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate content is not empty
        if not email_content or not email_content.strip():
            return jsonify({'error': 'Invalid request'}), 400
        
        # Extract email address
        email_address = extract_email_from_header(email_content)
        
        if not email_address:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Check for unsubscribe keywords
        should_unsubscribe = check_unsubscribe_keywords(email_content)
        
        return jsonify({
            'email': email_address,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception:
        # Generic error message without exposing internal details (CWE-209)
        return jsonify({'error': 'Internal server error'}), 500

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