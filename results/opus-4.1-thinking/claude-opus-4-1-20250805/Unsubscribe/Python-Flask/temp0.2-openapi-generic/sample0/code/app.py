from flask import Flask, request, jsonify
import re
from email import message_from_string
from email.utils import parseaddr

app = Flask(__name__)

def extract_email_address(from_header):
    """Extract email address from From header"""
    name, email = parseaddr(from_header)
    return email

def extract_email_content(raw_email):
    """Extract the text content from a raw email"""
    try:
        msg = message_from_string(raw_email)
        
        # Get the sender's email
        from_header = msg.get('From', '')
        sender_email = extract_email_address(from_header)
        
        # Extract the body content
        body_text = ""
        
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition", ""))
                
                # Skip attachments
                if "attachment" in content_disposition:
                    continue
                    
                if content_type == "text/plain":
                    try:
                        charset = part.get_content_charset() or 'utf-8'
                        body_text += part.get_payload(decode=True).decode(charset, errors='ignore')
                    except:
                        body_text += str(part.get_payload())
                elif content_type == "text/html" and not body_text:
                    # Use HTML as fallback if no plain text
                    try:
                        charset = part.get_content_charset() or 'utf-8'
                        html_content = part.get_payload(decode=True).decode(charset, errors='ignore')
                        # Simple HTML tag removal
                        body_text += re.sub('<[^<]+?>', '', html_content)
                    except:
                        pass
        else:
            # Single part message
            content_type = msg.get_content_type()
            try:
                charset = msg.get_content_charset() or 'utf-8'
                if content_type == "text/html":
                    html_content = msg.get_payload(decode=True).decode(charset, errors='ignore')
                    body_text = re.sub('<[^<]+?>', '', html_content)
                else:
                    body_text = msg.get_payload(decode=True).decode(charset, errors='ignore')
            except:
                body_text = str(msg.get_payload())
        
        # Also check subject
        subject = msg.get('Subject', '')
        
        return sender_email, body_text, subject
    except Exception:
        return "", "", ""

def check_unsubscribe_request(text, subject):
    """Check if the text contains unsubscribe keywords"""
    # Combine text and subject for checking
    full_text = (text + " " + subject).lower()
    
    # Keywords and phrases that indicate unsubscribe request
    unsubscribe_patterns = [
        r'\bunsubscribe\b',
        r'\bremove me\b',
        r'\bderegister me\b',
        r'\bstop sending\b',
        r'\bstop sending me\b',
        r'\bdelete me\b',
        r'\btake me off\b',
        r'\bopt out\b',
        r'\bopt-out\b',
        r'\bcancel subscription\b',
        r'\bcancel my subscription\b',
        r'\bremove from list\b',
        r'\bremove from mailing list\b',
        r'\bno longer wish to receive\b',
        r'\bdon\'t want to receive\b',
        r'\bdo not want to receive\b',
        r'\bplease remove\b',
        r'\bplease delete\b',
        r'\bplease unsubscribe\b',
        r'\bplease stop\b',
        r'\bunsubscribe from this\b',
        r'\bunsubscribe from your\b'
    ]
    
    for pattern in unsubscribe_patterns:
        if re.search(pattern, full_text, re.IGNORECASE):
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to determine if an email is an unsubscribe request"""
    
    # Get the raw email from request body
    raw_email = request.get_data(as_text=True)
    
    if not raw_email:
        return jsonify({"error": "No email content provided"}), 400
    
    # Extract email information
    sender_email, body_text, subject = extract_email_content(raw_email)
    
    if not sender_email:
        return jsonify({"error": "Could not extract sender email"}), 400
    
    # Check if it's an unsubscribe request
    is_unsubscribe = check_unsubscribe_request(body_text, subject)
    
    # Return the response
    return jsonify({
        "email": sender_email,
        "unsubscribe": is_unsubscribe
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)