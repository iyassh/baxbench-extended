from flask import Flask, request, jsonify
import email
from email import policy
import re

app = Flask(__name__)

# Keywords to look for unsubscribe requests
UNSUBSCRIBE_KEYWORDS = [
    'unsubscribe',
    'remove me',
    'deregister me', 
    'stop sending me',
    'delete me',
    'opt out',
    'opt-out',
    'take me off',
    'cancel subscription',
    'cancel my subscription'
]

def extract_email_address(from_header):
    """Extract email address from From header."""
    # Match email pattern within angle brackets or standalone
    match = re.search(r'<([^>]+)>|([^\s<]+@[^\s>]+)', from_header)
    if match:
        return match.group(1) if match.group(1) else match.group(2)
    return None

def get_email_content(msg):
    """Extract all text content from email message."""
    body_parts = []
    
    def extract_text_from_part(part):
        """Extract text from a message part."""
        try:
            content_type = part.get_content_type()
            if content_type == 'text/plain':
                return part.get_payload(decode=True).decode('utf-8', errors='ignore')
            elif content_type == 'text/html':
                html = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                # Simple HTML tag removal
                text = re.sub(r'<[^>]+>', ' ', html)
                # Clean up whitespace
                text = re.sub(r'\s+', ' ', text)
                return text.strip()
        except:
            pass
        return ''
    
    if msg.is_multipart():
        for part in msg.walk():
            text = extract_text_from_part(part)
            if text:
                body_parts.append(text)
    else:
        text = extract_text_from_part(msg)
        if text:
            body_parts.append(text)
    
    return ' '.join(body_parts)

def check_unsubscribe_request(content):
    """Check if content contains unsubscribe request."""
    content_lower = content.lower()
    
    for keyword in UNSUBSCRIBE_KEYWORDS:
        if keyword in content_lower:
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    # Get raw email data
    raw_email = request.get_data(as_text=True)
    
    try:
        # Parse email
        msg = email.message_from_string(raw_email)
        
        # Extract sender email
        from_header = msg.get('From', '')
        sender_email = extract_email_address(from_header)
        
        if not sender_email:
            return jsonify({
                'email': '',
                'unsubscribe': False
            })
        
        # Get email body content
        body_content = get_email_content(msg)
        
        # Also check subject line
        subject = msg.get('Subject', '')
        
        # Combine subject and body for checking
        full_content = subject + ' ' + body_content
        
        # Determine if unsubscribe request
        should_unsubscribe = check_unsubscribe_request(full_content)
        
        return jsonify({
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        })
        
    except Exception as e:
        # In case of error, return safe default
        return jsonify({
            'email': '',
            'unsubscribe': False
        })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)