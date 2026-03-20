from flask import Flask, request, jsonify
import re
import email
from email import policy

app = Flask(__name__)

# Unsubscribe keywords and phrases to look for
UNSUBSCRIBE_PATTERNS = [
    r'\bunsubscribe\b',
    r'\bremove\s+me\b',
    r'\bderegister\s+me\b',
    r'\bstop\s+sending\s+me\b',
    r'\bdelete\s+me\b',
    r'\btake\s+me\s+off\b',
    r'\bopt\s+out\b',
    r'\bcancel\s+subscription\b',
    r'\bremove\s+from\s+list\b',
    r'\bno\s+more\s+emails\b',
    r'\bstop\s+emails\b',
    r'\bunsubscribe\s+me\b',
    r'\bremove\s+my\s+email\b',
    r'\bdelete\s+my\s+email\b'
]

def extract_email_address(raw_email):
    """Extract the sender's email address from the raw email"""
    try:
        msg = email.message_from_string(raw_email, policy=policy.default)
        from_header = msg.get('From', '')
        
        # Extract email address from From header
        # Handle formats like "Name <email@example.com>" or just "email@example.com"
        email_match = re.search(r'<([^>]+)>|([^\s<>]+@[^\s<>]+)', from_header)
        if email_match:
            return email_match.group(1) or email_match.group(2)
        
        return None
    except Exception:
        return None

def check_unsubscribe_request(raw_email):
    """Check if the email contains an unsubscribe request"""
    try:
        msg = email.message_from_string(raw_email, policy=policy.default)
        
        # Get the email body
        body = ""
        
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    try:
                        body += part.get_content() + " "
                    except Exception:
                        pass
                elif part.get_content_type() == "text/html":
                    try:
                        # Extract text from HTML (basic approach)
                        html_content = part.get_content()
                        # Remove HTML tags
                        text = re.sub(r'<[^>]+>', ' ', html_content)
                        body += text + " "
                    except Exception:
                        pass
        else:
            try:
                body = msg.get_content()
            except Exception:
                body = str(msg.get_payload())
        
        # Also check subject line
        subject = msg.get('Subject', '')
        full_text = (subject + " " + body).lower()
        
        # Check for unsubscribe patterns
        for pattern in UNSUBSCRIBE_PATTERNS:
            if re.search(pattern, full_text, re.IGNORECASE):
                return True
        
        return False
    except Exception:
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if a user wants to unsubscribe"""
    
    # Get the raw email from request body
    if request.content_type != 'text/plain':
        return jsonify({'error': 'Content-Type must be text/plain'}), 400
    
    try:
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'Empty request body'}), 400
        
        # Extract email address
        email_address = extract_email_address(raw_email)
        
        if not email_address:
            return jsonify({'error': 'Could not extract email address'}), 400
        
        # Check if it's an unsubscribe request
        should_unsubscribe = check_unsubscribe_request(raw_email)
        
        return jsonify({
            'email': email_address,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)