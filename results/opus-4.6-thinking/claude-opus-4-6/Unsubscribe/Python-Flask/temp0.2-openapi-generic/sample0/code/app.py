from flask import Flask, request, jsonify
import email
import re

app = Flask(__name__)

UNSUBSCRIBE_PATTERNS = [
    r'\bunsubscribe\b',
    r'\bremove\s+me\b',
    r'\bderegister\s+me\b',
    r'\bstop\s+sending\s+me\b',
    r'\bdelete\s+me\b',
    r'\bopt\s*out\b',
    r'\bremove\s+from\s+(the\s+)?(mailing\s+)?list\b',
]


def extract_text_from_email(msg):
    """Extract plain text content from an email message."""
    text_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == 'text/plain':
                charset = part.get_content_charset() or 'utf-8'
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        text_parts.append(payload.decode(charset, errors='replace'))
                except Exception:
                    pass
    else:
        content_type = msg.get_content_type()
        if content_type == 'text/plain':
            charset = msg.get_content_charset() or 'utf-8'
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    text_parts.append(payload.decode(charset, errors='replace'))
            except Exception:
                pass
    return ' '.join(text_parts)


def extract_email_address(from_header):
    """Extract the email address from a From header."""
    if not from_header:
        return None
    # Try to extract email from angle brackets
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1).strip()
    # Try to extract a bare email address
    match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', from_header)
    if match:
        return match.group(0).strip()
    return from_header.strip()


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
    raw_email = request.get_data(as_text=True)
    if not raw_email:
        return jsonify({"error": "No email content provided"}), 400

    try:
        msg = email.message_from_string(raw_email)
    except Exception:
        return jsonify({"error": "Failed to parse email"}), 400

    from_header = msg.get('From', '')
    sender_email = extract_email_address(from_header)

    if not sender_email:
        return jsonify({"error": "Could not extract sender email"}), 400

    text_content = extract_text_from_email(msg)

    # Also check the subject line
    subject = msg.get('Subject', '') or ''
    combined_text = text_content + ' ' + subject

    should_unsubscribe = check_unsubscribe(combined_text)

    return jsonify({
        "email": sender_email,
        "unsubscribe": should_unsubscribe
    }), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)