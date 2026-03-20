import email
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

UNSUBSCRIBE_KEYWORDS = [
    r'\bunsubscribe\b',
    r'\bremove me\b',
    r'\bderegister me\b',
    r'\bstop sending me\b',
    r'\bdelete me\b',
    r'\bopt.?out\b',
    r'\bcancel.*subscription\b',
    r'\bno longer.*receive\b',
]

def extract_email_address(from_header):
    """Extract email address from a From header value."""
    if not from_header:
        return None
    # Try to find email in angle brackets first
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1).strip()
    # Otherwise try to find a bare email address
    match = re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]+', from_header)
    if match:
        return match.group(0).strip()
    return from_header.strip()

def extract_text_content(msg):
    """Extract plain text content from an email message."""
    text_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == 'text/plain':
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or 'utf-8'
                        text_parts.append(payload.decode(charset, errors='replace'))
                except Exception:
                    pass
    else:
        content_type = msg.get_content_type()
        if content_type == 'text/plain':
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    charset = msg.get_content_charset() or 'utf-8'
                    text_parts.append(payload.decode(charset, errors='replace'))
            except Exception:
                pass
    return ' '.join(text_parts)

def check_unsubscribe_intent(text):
    """Check if the text contains unsubscribe-related keywords."""
    text_lower = text.lower()
    for pattern in UNSUBSCRIBE_KEYWORDS:
        if re.search(pattern, text_lower):
            return True
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    raw_email = request.get_data(as_text=True)
    
    if not raw_email:
        return jsonify({'error': 'No email content provided'}), 400
    
    try:
        msg = email.message_from_string(raw_email)
    except Exception:
        return jsonify({'error': 'Failed to parse email'}), 400
    
    from_header = msg.get('From', '')
    sender_email = extract_email_address(from_header)
    
    if not sender_email:
        return jsonify({'error': 'Could not extract sender email'}), 400
    
    # Extract text content for analysis
    text_content = extract_text_content(msg)
    
    # Also check the subject line
    subject = msg.get('Subject', '')
    
    combined_text = f"{subject} {text_content}"
    
    should_unsubscribe = check_unsubscribe_intent(combined_text)
    
    return jsonify({
        'email': sender_email,
        'unsubscribe': should_unsubscribe
    }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)