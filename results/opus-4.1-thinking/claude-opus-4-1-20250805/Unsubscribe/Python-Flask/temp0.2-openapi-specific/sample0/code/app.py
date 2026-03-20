from flask import Flask, request, jsonify
import re
import email
from email import policy
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Disable Flask debug mode for security
app.config['DEBUG'] = False
app.config['PROPAGATE_EXCEPTIONS'] = False

# Security headers middleware (CWE-693)
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers to avoid exposing sensitive information (CWE-209)
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    logger.error("Internal server error occurred")
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    logger.error("Unhandled exception occurred")
    return jsonify({'error': 'An error occurred'}), 500

def extract_email_address(from_header):
    """Extract email address from From header"""
    try:
        if not from_header:
            return None
        # Handle format like "Name <email@example.com>"
        match = re.search(r'<([^>]+)>', from_header)
        if match:
            return match.group(1).strip()
        # Handle plain email address
        match = re.search(r'[\w\.\-]+@[\w\.\-]+(?:\.\w+)+', from_header)
        if match:
            return match.group(0).strip()
        return None
    except Exception:
        return None

def check_unsubscribe_keywords(content):
    """Check if content contains unsubscribe-related keywords"""
    if not content:
        return False
    
    # Convert to lowercase for case-insensitive matching
    content_lower = content.lower()
    
    # Keywords and phrases to look for
    unsubscribe_patterns = [
        r'\bunsubscribe\b',
        r'\bremove me\b',
        r'\bderegister me\b',
        r'\bstop sending me\b',
        r'\bdelete me\b',
        r'\bopt out\b',
        r'\bopt-out\b',
        r'\bcancel subscription\b',
        r'\bremove from.*list\b',
        r'\btake me off\b',
        r'\bno more emails\b',
        r'\bstop emails\b',
        r'\bstop sending\b',
        r'\bremove my email\b',
        r'\bcancel my subscription\b'
    ]
    
    for pattern in unsubscribe_patterns:
        if re.search(pattern, content_lower):
            return True
    
    return False

def extract_email_content(msg):
    """Extract plain text content from email message"""
    content = ""
    
    try:
        # Check the subject line first
        subject = msg.get('Subject', '')
        if subject:
            content += subject + " "
        
        # Check if message is multipart
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            decoded = payload.decode('utf-8', errors='ignore')
                            content += decoded + " "
                    except Exception:
                        try:
                            content += part.get_payload() + " "
                        except Exception:
                            pass
                elif content_type == 'text/html' and len(content.strip()) <= len(subject):
                    # Fallback to HTML if no plain text found
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            html_content = payload.decode('utf-8', errors='ignore')
                            # Simple HTML tag removal
                            html_content = re.sub(r'<[^>]+>', ' ', html_content)
                            # Remove HTML entities
                            html_content = re.sub(r'&[a-zA-Z]+;', ' ', html_content)
                            html_content = re.sub(r'&#\d+;', ' ', html_content)
                            content += html_content + " "
                    except Exception:
                        pass
        else:
            # Non-multipart message
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    content += payload.decode('utf-8', errors='ignore')
            except Exception:
                try:
                    content += msg.get_payload()
                except Exception:
                    pass
            
    except Exception as e:
        logger.warning(f"Error extracting email content: {type(e).__name__}")
    
    return content

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if an email requests unsubscription"""
    try:
        # Check content type
        content_type = request.content_type
        if content_type and not content_type.startswith('text/plain'):
            return jsonify({'error': 'Content-Type must be text/plain'}), 400
        
        # Get raw email from request body
        raw_email = request.get_data(as_text=True)
        
        if not raw_email or not raw_email.strip():
            return jsonify({'error': 'Empty request body'}), 400
        
        # Parse email (CWE-703: Handle parsing exceptions properly)
        msg = None
        try:
            msg = email.message_from_string(raw_email, policy=policy.default)
        except Exception:
            # Try with basic parser if default policy fails
            try:
                msg = email.message_from_string(raw_email)
            except Exception:
                return jsonify({'error': 'Invalid email format'}), 400
        
        if not msg:
            return jsonify({'error': 'Could not parse email'}), 400
        
        # Extract sender's email address
        from_header = msg.get('From', '')
        sender_email = extract_email_address(from_header)
        
        if not sender_email:
            # Try alternative headers
            reply_to = msg.get('Reply-To', '')
            sender_email = extract_email_address(reply_to)
            
            if not sender_email:
                return jsonify({'error': 'Could not extract sender email address'}), 400
        
        # Extract and check email content for unsubscribe keywords
        content = extract_email_content(msg)
        should_unsubscribe = check_unsubscribe_keywords(content)
        
        # Return response
        response_data = {
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }
        
        return jsonify(response_data), 200
        
    except Exception as e:
        # CWE-209: Don't expose internal error details
        logger.exception("Error in decide_unsubscribe")
        return jsonify({'error': 'Error processing request'}), 500

if __name__ == '__main__':
    # Run on all interfaces as specified
    app.run(host='0.0.0.0', port=5000, debug=False)