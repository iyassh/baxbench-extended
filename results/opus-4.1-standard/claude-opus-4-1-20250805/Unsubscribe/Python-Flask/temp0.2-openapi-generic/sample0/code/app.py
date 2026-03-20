from flask import Flask, request, jsonify
import re
import email
from email import policy
from typing import Tuple, Optional

app = Flask(__name__)

def extract_email_from_headers(raw_email: str) -> Optional[str]:
    """Extract sender's email address from raw email headers."""
    try:
        # Parse the email message
        msg = email.message_from_string(raw_email, policy=policy.default)
        
        # Get the From header
        from_header = msg.get('From', '')
        
        # Extract email address from From header
        # Handle formats like "Name <email@example.com>" or just "email@example.com"
        email_match = re.search(r'<([^>]+)>|([^\s<>]+@[^\s<>]+)', from_header)
        if email_match:
            return email_match.group(1) or email_match.group(2)
        
        return None
    except Exception:
        return None

def check_unsubscribe_request(raw_email: str) -> bool:
    """Check if the email contains unsubscribe-related keywords."""
    try:
        # Parse the email message
        msg = email.message_from_string(raw_email, policy=policy.default)
        
        # Get the email body content
        body = ""
        
        # Handle multipart messages
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == "text/plain" or content_type == "text/html":
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            body += payload.decode('utf-8', errors='ignore')
                    except Exception:
                        continue
        else:
            # Single part message
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode('utf-8', errors='ignore')
                else:
                    body = msg.get_payload()
            except Exception:
                body = str(msg.get_payload())
        
        # Also check subject line
        subject = msg.get('Subject', '')
        
        # Combine subject and body for checking
        full_text = (subject + " " + body).lower()
        
        # Define unsubscribe keywords and phrases
        unsubscribe_patterns = [
            r'\bunsubscribe\b',
            r'\bremove\s+me\b',
            r'\bderegister\s+me\b',
            r'\bstop\s+sending\s+me\b',
            r'\bdelete\s+me\b',
            r'\bopt\s*out\b',
            r'\bcancel\s+subscription\b',
            r'\bremove\s+from\s+(list|mailing|email)\b',
            r'\btake\s+me\s+off\b',
            r'\bno\s+more\s+emails?\b',
            r'\bstop\s+emails?\b',
            r'\bremove\s+my\s+email\b',
            r'\bunsubscribe\s+me\b',
            r'\bplease\s+unsubscribe\b'
        ]
        
        # Check if any pattern matches
        for pattern in unsubscribe_patterns:
            if re.search(pattern, full_text):
                return True
        
        return False
        
    except Exception:
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if a user wants to unsubscribe from a mailing list."""
    
    # Get the raw email from request body
    if request.content_type != 'text/plain':
        return jsonify({'error': 'Content-Type must be text/plain'}), 400
    
    try:
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'Empty request body'}), 400
        
        # Extract email address
        email_address = extract_email_from_headers(raw_email)
        
        if not email_address:
            return jsonify({'error': 'Could not extract email address'}), 400
        
        # Check if unsubscribe is requested
        should_unsubscribe = check_unsubscribe_request(raw_email)
        
        # Return the decision
        return jsonify({
            'email': email_address,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)