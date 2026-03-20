import re
from flask import Flask, request, jsonify
from email.parser import Parser
from email.message import Message

app = Flask(__name__)

# Keywords that indicate an unsubscribe request
UNSUBSCRIBE_KEYWORDS = [
    r'\bunsubscribe\b',
    r'\bremove\s+me\b',
    r'\bderegister\s+me\b',
    r'\bstop\s+sending\s+me\b',
    r'\bdelete\s+me\b',
]

def extract_email_from_headers(email_content: str) -> str:
    """Extract the sender's email address from the email headers."""
    parser = Parser()
    message = parser.parsestr(email_content)
    
    from_header = message.get('From', '')
    
    # Extract email address from "Name <email@domain.com>" format
    email_match = re.search(r'<([^>]+)>', from_header)
    if email_match:
        return email_match.group(1)
    
    # If no angle brackets, try to extract email directly
    email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', from_header)
    if email_match:
        return email_match.group(0)
    
    return ''

def extract_body_text(email_content: str) -> str:
    """Extract the plain text body from the email."""
    parser = Parser()
    message = parser.parsestr(email_content)
    
    body_text = ''
    
    # Handle multipart messages
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            
            # Prefer plain text over HTML
            if content_type == 'text/plain':
                payload = part.get_payload(decode=True)
                if isinstance(payload, bytes):
                    body_text = payload.decode('utf-8', errors='ignore')
                else:
                    body_text = payload
                break
            elif content_type == 'text/html' and not body_text:
                payload = part.get_payload(decode=True)
                if isinstance(payload, bytes):
                    body_text = payload.decode('utf-8', errors='ignore')
                else:
                    body_text = payload
    else:
        payload = message.get_payload(decode=True)
        if isinstance(payload, bytes):
            body_text = payload.decode('utf-8', errors='ignore')
        else:
            body_text = payload
    
    return body_text.lower()

def should_unsubscribe(email_body: str) -> bool:
    """Determine if the email contains unsubscribe keywords."""
    for keyword_pattern in UNSUBSCRIBE_KEYWORDS:
        if re.search(keyword_pattern, email_body, re.IGNORECASE):
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
        # Get the raw email content from the request body
        email_content = request.get_data(as_text=True)
        
        if not email_content or not email_content.strip():
            return jsonify({
                'email': '',
                'unsubscribe': False
            }), 400
        
        # Extract email address from headers
        email_address = extract_email_from_headers(email_content)
        
        # Extract body text
        body_text = extract_body_text(email_content)
        
        # Determine if unsubscribe was requested
        unsubscribe = should_unsubscribe(body_text)
        
        return jsonify({
            'email': email_address,
            'unsubscribe': unsubscribe
        }), 200
    
    except Exception as e:
        # Return a safe error response without exposing internal details
        return jsonify({
            'email': '',
            'unsubscribe': False
        }), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)