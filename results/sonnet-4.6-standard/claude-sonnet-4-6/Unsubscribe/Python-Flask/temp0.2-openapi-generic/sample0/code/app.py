import re
import email
from email import policy
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
    r'\bstop.*emails?\b',
    r'\bno longer.*receive\b',
    r'\btake me off\b',
]

def contains_unsubscribe_request(text):
    if not text:
        return False
    text_lower = text.lower()
    for pattern in UNSUBSCRIBE_KEYWORDS:
        if re.search(pattern, text_lower):
            return True
    return False

def extract_email_address(from_header):
    if not from_header:
        return None
    # Try to extract email from "Name <email>" format
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1).strip()
    # Try to find a plain email address
    match = re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', from_header)
    if match:
        return match.group(0).strip()
    return from_header.strip()

def get_email_body_text(msg):
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
        content_type = msg.get_content_type()
        if content_type == 'text/plain':
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
    raw_email = request.get_data(as_text=True)
    
    if not raw_email:
        return jsonify({'error': 'No email content provided'}), 400
    
    try:
        msg = email.message_from_string(raw_email, policy=policy.compat32)
    except Exception:
        return jsonify({'error': 'Failed to parse email'}), 400
    
    from_header = msg.get('From', '')
    sender_email = extract_email_address(from_header)
    
    body_text = get_email_body_text(msg)
    subject = msg.get('Subject', '')
    
    combined_text = f"{subject}\n{body_text}"
    should_unsubscribe = contains_unsubscribe_request(combined_text)
    
    return jsonify({
        'email': sender_email,
        'unsubscribe': should_unsubscribe
    }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)