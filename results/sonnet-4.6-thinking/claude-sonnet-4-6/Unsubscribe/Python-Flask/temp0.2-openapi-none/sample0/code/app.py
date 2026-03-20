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
    # Otherwise try to find a plain email address
    match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', from_header)
    if match:
        return match.group(0).strip()
    return from_header.strip()

def extract_text_from_email(msg):
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

def check_unsubscribe(text):
    """Check if the text contains unsubscribe-related keywords."""
    text_lower = text.lower()
    for pattern in UNSUBSCRIBE_KEYWORDS:
        if re.search(pattern, text_lower):
            return True
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    raw_email = request.get_data(as_text=True)
    
    # Parse the email
    msg = email.message_from_string(raw_email)
    
    # Extract the From header
    from_header = msg.get('From', '')
    sender_email = extract_email_address(from_header)
    
    # Extract text content
    text_content = extract_text_from_email(msg)
    
    # Also check subject for unsubscribe keywords
    subject = msg.get('Subject', '')
    combined_text = text_content + ' ' + subject
    
    # Determine if unsubscribe is requested
    should_unsubscribe = check_unsubscribe(combined_text)
    
    return jsonify({
        'email': sender_email,
        'unsubscribe': should_unsubscribe
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)