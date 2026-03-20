from flask import Flask, request, jsonify
import re
import email
from email import policy
import logging

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Disable debug mode for production
app.config['DEBUG'] = False
app.config['PROPAGATE_EXCEPTIONS'] = False

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers to avoid information disclosure
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}")
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    logger.error(f"Unhandled exception: {error}")
    return jsonify({'error': 'An error occurred'}), 500

def extract_email_address(raw_email):
    """Extract sender email address from raw email headers"""
    try:
        msg = email.message_from_string(raw_email, policy=policy.default)
        from_header = msg.get('From', '')
        
        # Extract email from "Name <email@domain.com>" format
        email_match = re.search(r'<([^>]+)>', from_header)
        if email_match:
            return email_match.group(1)
        
        # Try to match plain email format
        email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', from_header)
        if email_match:
            return email_match.group(0)
            
        return None
    except Exception as e:
        logger.warning(f"Error extracting email address: {e}")
        return None

def check_unsubscribe_request(raw_email):
    """Check if the email contains unsubscribe keywords"""
    try:
        # Parse the email
        msg = email.message_from_string(raw_email, policy=policy.default)
        
        # Get email body content
        body = ""
        
        # Extract text from multipart messages
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    try:
                        body += part.get_content() + " "
                    except:
                        try:
                            body += part.get_payload(decode=True).decode('utf-8', errors='ignore') + " "
                        except:
                            pass
        else:
            try:
                body = msg.get_content()
            except:
                try:
                    body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
                except:
                    body = str(msg.get_payload())
        
        # Also check subject
        subject = msg.get('Subject', '')
        full_text = (body + " " + subject).lower()
        
        # Define unsubscribe patterns
        unsubscribe_patterns = [
            r'\bunsubscribe\b',
            r'\bremove me\b',
            r'\bderegister me\b',
            r'\bstop sending me\b',
            r'\bdelete me\b',
            r'\bopt out\b',
            r'\bopt-out\b',
            r'\bcancel subscription\b',
            r'\bremove from list\b',
            r'\btake me off\b',
            r'\bno more emails\b',
            r'\bstop emails\b'
        ]
        
        # Check for unsubscribe patterns
        for pattern in unsubscribe_patterns:
            if re.search(pattern, full_text):
                return True
                
        return False
        
    except Exception as e:
        logger.warning(f"Error checking unsubscribe request: {e}")
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if user wants to unsubscribe"""
    try:
        # Validate content type
        if request.content_type not in ['text/plain', 'text/plain; charset=UTF-8', None]:
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get raw email data
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'No email content provided'}), 400
        
        # Limit input size to prevent DoS
        max_size = 1024 * 1024  # 1MB
        if len(raw_email) > max_size:
            return jsonify({'error': 'Email content too large'}), 400
        
        # Extract email address
        email_address = extract_email_address(raw_email)
        
        if not email_address:
            return jsonify({
                'email': '',
                'unsubscribe': False
            }), 200
        
        # Check for unsubscribe request
        should_unsubscribe = check_unsubscribe_request(raw_email)
        
        return jsonify({
            'email': email_address,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        return jsonify({'error': 'Failed to process request'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)