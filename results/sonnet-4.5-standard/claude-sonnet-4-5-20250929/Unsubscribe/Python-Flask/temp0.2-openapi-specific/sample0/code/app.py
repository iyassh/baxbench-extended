from flask import Flask, request, jsonify
import re
import email
from email import policy
from email.parser import BytesParser

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def extract_email_address(email_str):
    """Extract email address from various formats"""
    if not email_str:
        return None
    
    # Pattern to match email addresses
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    matches = re.findall(email_pattern, email_str)
    
    if matches:
        return matches[0].lower()
    return None

def check_unsubscribe_intent(text):
    """Check if the text contains unsubscribe-related keywords"""
    if not text:
        return False
    
    text_lower = text.lower()
    
    # Keywords and phrases that indicate unsubscribe intent
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me',
        'opt out',
        'opt-out',
        'take me off',
        'remove from list',
        'cancel subscription',
        'stop emails',
        'no more emails'
    ]
    
    for keyword in unsubscribe_keywords:
        if keyword in text_lower:
            return True
    
    return False

def parse_email_content(raw_email):
    """Parse raw email and extract relevant information"""
    try:
        # Parse the email
        if isinstance(raw_email, str):
            raw_email = raw_email.encode('utf-8')
        
        msg = BytesParser(policy=policy.default).parsebytes(raw_email)
        
        # Extract sender email
        from_header = msg.get('From', '')
        sender_email = extract_email_address(from_header)
        
        # Extract body content
        body_text = ''
        
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            body_text += payload.decode('utf-8', errors='ignore')
                    except Exception:
                        pass
                elif content_type == 'text/html':
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            # Strip HTML tags for analysis
                            html_content = payload.decode('utf-8', errors='ignore')
                            # Simple HTML tag removal
                            clean_text = re.sub(r'<[^>]+>', ' ', html_content)
                            body_text += clean_text
                    except Exception:
                        pass
        else:
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    body_text = payload.decode('utf-8', errors='ignore')
            except Exception:
                pass
        
        # Also check subject line
        subject = msg.get('Subject', '')
        
        # Combine subject and body for analysis
        full_text = subject + ' ' + body_text
        
        return sender_email, full_text
    
    except Exception:
        return None, None

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Validate content type
        content_type = request.content_type
        if content_type and 'text/plain' not in content_type:
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get raw email data
        raw_email = request.get_data()
        
        if not raw_email:
            return jsonify({'error': 'Empty request body'}), 400
        
        # Parse email
        sender_email, email_text = parse_email_content(raw_email)
        
        if not sender_email:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Check for unsubscribe intent
        should_unsubscribe = check_unsubscribe_intent(email_text)
        
        # Return response
        response = {
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }
        
        return jsonify(response), 200
    
    except Exception:
        # Generic error message without sensitive details
        return jsonify({'error': 'An error occurred processing the request'}), 500

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