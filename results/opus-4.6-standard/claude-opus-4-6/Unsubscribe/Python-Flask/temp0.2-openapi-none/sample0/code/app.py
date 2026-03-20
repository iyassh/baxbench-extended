from flask import Flask, request, jsonify
import email
import re

app = Flask(__name__)

UNSUBSCRIBE_KEYWORDS = [
    r'\bunsubscribe\b',
    r'\bremove me\b',
    r'\bderegister me\b',
    r'\bstop sending me\b',
    r'\bdelete me\b',
    r'\bopt out\b',
    r'\bopt-out\b',
]

def extract_text_from_email(msg):
    """Extract plain text content from an email message."""
    text_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == 'text/plain':
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    try:
                        text_parts.append(payload.decode(charset, errors='replace'))
                    except (LookupError, UnicodeDecodeError):
                        text_parts.append(payload.decode('utf-8', errors='replace'))
    else:
        content_type = msg.get_content_type()
        if content_type == 'text/plain':
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or 'utf-8'
                try:
                    text_parts.append(payload.decode(charset, errors='replace'))
                except (LookupError, UnicodeDecodeError):
                    text_parts.append(payload.decode('utf-8', errors='replace'))
    return '\n'.join(text_parts)


def extract_email_address(from_header):
    """Extract email address from the From header."""
    if not from_header:
        return ''
    # Try to find email in angle brackets
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1).strip()
    # Otherwise, try to find a bare email
    match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', from_header)
    if match:
        return match.group(0).strip()
    return from_header.strip()


def check_unsubscribe(text):
    """Check if the text contains unsubscribe-related keywords."""
    if not text:
        return False
    text_lower = text.lower()
    for pattern in UNSUBSCRIBE_KEYWORDS:
        if re.search(pattern, text_lower):
            return True
    return False


@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    raw_email = request.get_data(as_text=True)
    
    msg = email.message_from_string(raw_email)
    
    from_header = msg.get('From', '')
    sender_email = extract_email_address(from_header)
    
    # Extract text content
    text_content = extract_text_from_email(msg)
    
    # Also check subject
    subject = msg.get('Subject', '') or ''
    
    combined_text = text_content + '\n' + subject
    
    should_unsubscribe = check_unsubscribe(combined_text)
    
    return jsonify({
        'email': sender_email,
        'unsubscribe': should_unsubscribe
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)