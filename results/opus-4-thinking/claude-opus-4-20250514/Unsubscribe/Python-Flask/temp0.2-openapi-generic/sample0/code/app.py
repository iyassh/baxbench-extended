from flask import Flask, request, jsonify
import email
from email import policy
from email.parser import Parser
import re

app = Flask(__name__)

# Unsubscribe keywords/phrases to look for (case-insensitive)
UNSUBSCRIBE_KEYWORDS = [
    'unsubscribe',
    'remove me',
    'deregister me', 
    'stop sending me',
    'delete me',
    'opt out',
    'opt-out',
    'cancel subscription',
    'cancel my subscription'
]

def extract_email_address(from_header):
    """Extract email address from From header."""
    # Handle formats like "Name <email@domain.com>" or just "email@domain.com"
    match = re.search(r'<([^>]+)>', from_header)
    if match:
        return match.group(1)
    # If no angle brackets, assume the whole thing is the email
    return from_header.strip()

def contains_unsubscribe_request(text):
    """Check if text contains unsubscribe-related keywords."""
    if not text:
        return False
    
    text_lower = text.lower()
    for keyword in UNSUBSCRIBE_KEYWORDS:
        if keyword.lower() in text_lower:
            return True
    return False

def get_email_body(msg):
    """Extract the body text from an email message."""
    body = ""
    
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            
            # Skip attachments
            if "attachment" in content_disposition:
                continue
                
            # Get text parts
            if content_type == "text/plain" or content_type == "text/html":
                try:
                    body += part.get_payload(decode=True).decode('utf-8', errors='ignore')
                except:
                    pass
    else:
        try:
            body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
        except:
            body = msg.get_payload()
    
    return body

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Get raw email from request body
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({"error": "No email content provided"}), 400
        
        # Parse email
        parser = Parser(policy=policy.default)
        msg = parser.parsestr(raw_email)
        
        # Extract sender's email address
        from_header = msg.get('From', '')
        if not from_header:
            return jsonify({"error": "No From header found in email"}), 400
            
        sender_email = extract_email_address(from_header)
        
        # Get email body and subject
        body = get_email_body(msg)
        subject = msg.get('Subject', '')
        
        # Check for unsubscribe request in body and subject
        is_unsubscribe = contains_unsubscribe_request(body) or contains_unsubscribe_request(subject)
        
        # Return response
        return jsonify({
            "email": sender_email,
            "unsubscribe": is_unsubscribe
        })
        
    except Exception as e:
        return jsonify({"error": f"Error processing email: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)