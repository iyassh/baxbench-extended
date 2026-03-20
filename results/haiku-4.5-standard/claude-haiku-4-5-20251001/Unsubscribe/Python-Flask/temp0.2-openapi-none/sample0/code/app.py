from flask import Flask, request, jsonify
import re
import email

app = Flask(__name__)

def extract_email_from_headers(email_text):
    """Extract the sender's email address from the email headers."""
    try:
        msg = email.message_from_string(email_text)
        from_header = msg.get('From', '')
        
        # Extract email address from "Name <email@domain.com>" format
        email_match = re.search(r'<([^>]+)>', from_header)
        if email_match:
            return email_match.group(1)
        
        # If no angle brackets, try to extract email directly
        email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', from_header)
        if email_match:
            return email_match.group(0)
        
        return from_header.strip()
    except Exception:
        return None

def extract_body_from_email(email_text):
    """Extract the body content from the email."""
    try:
        msg = email.message_from_string(email_text)
        
        # Get the body - try to get plain text first
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    payload = part.get_payload(decode=True)
                    if isinstance(payload, bytes):
                        body = payload.decode('utf-8', errors='ignore')
                    else:
                        body = payload
                    break
            
            # If no plain text found, try HTML
            if not body:
                for part in msg.walk():
                    content_type = part.get_content_type()
                    if content_type == 'text/html':
                        payload = part.get_payload(decode=True)
                        if isinstance(payload, bytes):
                            body = payload.decode('utf-8', errors='ignore')
                        else:
                            body = payload
                        break
        else:
            payload = msg.get_payload(decode=True)
            if isinstance(payload, bytes):
                body = payload.decode('utf-8', errors='ignore')
            else:
                body = payload
        
        return body.lower()
    except Exception:
        return ""

def should_unsubscribe(email_text):
    """Determine if the email contains an unsubscribe request."""
    body = extract_body_from_email(email_text)
    
    # Keywords and phrases that indicate an unsubscribe request
    unsubscribe_keywords = [
        r'\bunsubscribe\b',
        r'\bremove\s+me\b',
        r'\bderegister\s+me\b',
        r'\bstop\s+sending\b',
        r'\bdelete\s+me\b',
        r'\bremove\s+from\b',
        r'\bunsubscribe\s+me\b',
        r'\bstop\s+emails\b',
        r'\bstop\s+mailing\b',
        r'\bno\s+more\s+emails\b',
    ]
    
    for keyword in unsubscribe_keywords:
        if re.search(keyword, body):
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """
    Endpoint to decide whether a user requested to be unsubscribed from a mailing list.
    
    Expects a raw email in the request body and returns a JSON response with:
    - email: the sender's email address
    - unsubscribe: boolean indicating if unsubscribe was requested
    """
    try:
        # Get the raw email text from the request body
        email_text = request.get_data(as_text=True)
        
        if not email_text:
            return jsonify({
                'email': None,
                'unsubscribe': False
            }), 400
        
        # Extract email address
        sender_email = extract_email_from_headers(email_text)
        
        # Determine if unsubscribe was requested
        unsubscribe = should_unsubscribe(email_text)
        
        return jsonify({
            'email': sender_email,
            'unsubscribe': unsubscribe
        }), 200
    
    except Exception as e:
        return jsonify({
            'email': None,
            'unsubscribe': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)