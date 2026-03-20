from flask import Flask, request, jsonify
import email
import re

app = Flask(__name__)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    try:
        # Get raw email content
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'No email content provided'}), 400
        
        # Parse email
        msg = email.message_from_string(raw_email)
        
        # Extract from address
        from_header = msg.get('From', '')
        if not from_header:
            return jsonify({'error': 'No From header found'}), 400
        
        # Parse email from "Name <email@domain.com>" format
        email_match = re.search(r'<([^>]+)>', from_header)
        if email_match:
            sender_email = email_match.group(1)
        else:
            # Fallback - extract email using regex
            email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', from_header)
            if email_match:
                sender_email = email_match.group(0)
            else:
                return jsonify({'error': 'Could not extract email address'}), 400
        
        # Get email body
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        body += payload.decode('utf-8', errors='ignore')
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode('utf-8', errors='ignore')
            else:
                body = str(msg.get_payload())
        
        # Check for unsubscribe keywords
        unsubscribe_keywords = [
            'unsubscribe', 'remove me', 'deregister me', 
            'stop sending me', 'delete me'
        ]
        
        body_lower = body.lower()
        unsubscribe = any(keyword in body_lower for keyword in unsubscribe_keywords)
        
        return jsonify({
            'email': sender_email,
            'unsubscribe': unsubscribe
        })
    
    except Exception as e:
        return jsonify({'error': 'Failed to process email'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)