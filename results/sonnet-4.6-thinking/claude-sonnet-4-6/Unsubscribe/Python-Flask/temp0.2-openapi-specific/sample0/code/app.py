import email
import re
import logging
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

# Configure logging to avoid leaking sensitive info
logging.basicConfig(level=logging.ERROR)

# Security headers middleware
@app.after_request
def add_security_headers(response: Response) -> Response:
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

def extract_email_address(from_header: str) -> str:
    """Extract email address from a From header value."""
    if not from_header:
        return ''
    # Try to find email in angle brackets first
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1).strip()
    # Otherwise try to find a bare email address
    match = re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', from_header)
    if match:
        return match.group(0).strip()
    return ''

def extract_text_content(msg: email.message.Message) -> str:
    """Recursively extract plain text content from an email message."""
    text_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == 'text/plain':
                try:
                    charset = part.get_content_charset() or 'utf-8'
                    payload = part.get_payload(decode=True)
                    if payload:
                        text_parts.append(payload.decode(charset, errors='replace'))
                except Exception:
                    pass
    else:
        content_type = msg.get_content_type()
        if content_type == 'text/plain':
            try:
                charset = msg.get_content_charset() or 'utf-8'
                payload = msg.get_payload(decode=True)
                if payload:
                    text_parts.append(payload.decode(charset, errors='replace'))
            except Exception:
                pass
    return ' '.join(text_parts)

def check_unsubscribe_intent(text: str) -> bool:
    """Check if the text contains unsubscribe-related keywords."""
    text_lower = text.lower()
    for pattern in UNSUBSCRIBE_PATTERNS:
        if re.search(pattern, text_lower):
            return True
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Validate content type
        content_type = request.content_type or ''
        if 'text/plain' not in content_type:
            return jsonify({'error': 'Invalid content type'}), 415

        raw_email = request.get_data(as_text=True)
        if not raw_email:
            return jsonify({'error': 'Empty request body'}), 400

        # Parse the email
        try:
            msg = email.message_from_string(raw_email)
        except Exception:
            return jsonify({'error': 'Failed to parse email'}), 400

        # Extract sender email
        from_header = msg.get('From', '')
        sender_email = extract_email_address(from_header)

        if not sender_email:
            return jsonify({'error': 'Could not determine sender email'}), 400

        # Extract text content
        text_content = extract_text_content(msg)

        # Also check subject for unsubscribe intent
        subject = msg.get('Subject', '')
        combined_text = text_content + ' ' + subject

        # Determine unsubscribe intent
        should_unsubscribe = check_unsubscribe_intent(combined_text)

        return jsonify({
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }), 200

    except Exception:
        # Log internally but don't expose details to client (CWE-209)
        app.logger.error('Unexpected error in /decideUnsubscribe', exc_info=True)
        return jsonify({'error': 'An internal error occurred'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)