import email
import re
import logging
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configure logging to avoid leaking sensitive info
logging.basicConfig(level=logging.ERROR)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

UNSUBSCRIBE_PATTERNS = [
    r'\bunsubscribe\b',
    r'\bremove me\b',
    r'\bderegister me\b',
    r'\bstop sending me\b',
    r'\bdelete me\b',
    r'\bopt.?out\b',
]

def check_unsubscribe(text):
    """Check if the text contains unsubscribe-related keywords."""
    if not text:
        return False
    text_lower = text.lower()
    for pattern in UNSUBSCRIBE_PATTERNS:
        if re.search(pattern, text_lower):
            return True
    return False

def extract_email_address(from_header):
    """Extract email address from a From header value."""
    if not from_header:
        return None
    # Use email.headerregistry or simple regex
    # Try to parse with email module
    try:
        parsed = email.headerregistry.Address(addr_spec=from_header)
        if parsed.username and parsed.domain:
            return f"{parsed.username}@{parsed.domain}"
    except Exception:
        pass
    
    # Fallback: regex to find email address
    match = re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', from_header)
    if match:
        return match.group(0)
    return None

def get_plain_text_body(msg):
    """Extract plain text body from email message."""
    body_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get('Content-Disposition', ''))
            if content_type == 'text/plain' and 'attachment' not in content_disposition:
                try:
                    charset = part.get_content_charset() or 'utf-8'
                    payload = part.get_payload(decode=True)
                    if payload:
                        body_parts.append(payload.decode(charset, errors='replace'))
                except Exception:
                    pass
    else:
        try:
            charset = msg.get_content_charset() or 'utf-8'
            payload = msg.get_payload(decode=True)
            if payload:
                body_parts.append(payload.decode(charset, errors='replace'))
        except Exception:
            pass
    return '\n'.join(body_parts)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Get raw email content
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'No email content provided'}), 400
        
        # Parse the email
        try:
            msg = email.message_from_string(raw_email)
        except Exception:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Extract sender email
        from_header = msg.get('From', '')
        sender_email = extract_email_address(from_header)
        
        if not sender_email:
            return jsonify({'error': 'Could not extract sender email'}), 400
        
        # Extract subject
        subject = msg.get('Subject', '') or ''
        
        # Extract body
        body = get_plain_text_body(msg)
        
        # Check for unsubscribe intent in subject and body
        combined_text = f"{subject}\n{body}"
        should_unsubscribe = check_unsubscribe(combined_text)
        
        return jsonify({
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }), 200
    
    except Exception:
        # Log the error internally but don't expose details to client
        app.logger.error('Error processing request', exc_info=True)
        return jsonify({'error': 'An internal error occurred'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)