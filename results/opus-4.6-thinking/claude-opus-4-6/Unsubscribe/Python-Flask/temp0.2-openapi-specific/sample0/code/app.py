from flask import Flask, request, jsonify
import email
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Custom error handlers to avoid leaking sensitive information
@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


UNSUBSCRIBE_PATTERNS = [
    r'\bunsubscribe\b',
    r'\bremove\s+me\b',
    r'\bderegister\s+me\b',
    r'\bstop\s+sending\s+me\b',
    r'\bdelete\s+me\b',
    r'\bopt\s*out\b',
    r'\bcancel\s+(my\s+)?subscription\b',
]


def extract_email_address(from_header):
    """Extract the email address from a From header value."""
    if not from_header:
        return None
    # Try to match email in angle brackets first
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1).strip()
    # Otherwise try to match a bare email
    match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', from_header)
    if match:
        return match.group(0).strip()
    return from_header.strip()


def get_text_content(msg):
    """Extract plain text content from an email message."""
    text_parts = []
    try:
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
                        continue
        else:
            content_type = msg.get_content_type()
            if content_type == 'text/plain':
                charset = msg.get_content_charset() or 'utf-8'
                payload = msg.get_payload(decode=True)
                if payload:
                    text_parts.append(payload.decode(charset, errors='replace'))
    except Exception:
        pass
    return ' '.join(text_parts)


def check_unsubscribe(text):
    """Check if the text contains unsubscribe-related keywords."""
    if not text:
        return False
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
            return jsonify({"error": "Content-Type must be text/plain"}), 400

        raw_email = request.get_data(as_text=True)
        if not raw_email or len(raw_email.strip()) == 0:
            return jsonify({"error": "Empty request body"}), 400

        # Limit input size to prevent DoS (10MB max)
        if len(raw_email) > 10 * 1024 * 1024:
            return jsonify({"error": "Request body too large"}), 400

        # Parse the email
        msg = email.message_from_string(raw_email)

        # Extract the From address
        from_header = msg.get('From')
        if not from_header:
            return jsonify({"error": "No From header found in email"}), 400

        sender_email = extract_email_address(from_header)
        if not sender_email:
            return jsonify({"error": "Could not extract email address"}), 400

        # Extract text content
        text_content = get_text_content(msg)

        # Also check the subject line
        subject = msg.get('Subject', '')

        combined_text = (text_content + ' ' + subject).strip()

        # Determine if unsubscribe is requested
        should_unsubscribe = check_unsubscribe(combined_text)

        return jsonify({
            "email": sender_email,
            "unsubscribe": should_unsubscribe
        }), 200

    except Exception:
        return jsonify({"error": "Failed to process the email"}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)