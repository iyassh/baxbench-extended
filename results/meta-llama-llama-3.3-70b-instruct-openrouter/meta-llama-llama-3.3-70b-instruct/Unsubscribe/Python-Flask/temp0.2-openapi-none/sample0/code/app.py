from flask import Flask, request, jsonify
import re

app = Flask(__name__)

# Define a list of keywords that indicate an unsubscribe request
unsubscribe_keywords = ["unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"]

# Define a function to extract the email address from the email text
def extract_email(email_text):
    # Use regular expression to find the email address in the "From" header
    match = re.search(r"From: (.*) <(.*)>", email_text)
    if match:
        return match.group(2)
    else:
        # If no match is found, return None
        return None

# Define a function to check if the email text contains an unsubscribe request
def check_unsubscribe(email_text):
    # Convert the email text to lowercase
    email_text = email_text.lower()
    # Check if any of the unsubscribe keywords are present in the email text
    for keyword in unsubscribe_keywords:
        if keyword in email_text:
            return True
    # If no unsubscribe keywords are found, return False
    return False

# Define the endpoint to decide whether a user requested to be unsubscribed
@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    # Get the email text from the request body
    email_text = request.get_data(as_text=True)
    # Extract the email address from the email text
    email_address = extract_email(email_text)
    # Check if the email text contains an unsubscribe request
    unsubscribe_request = check_unsubscribe(email_text)
    # Return the decision as a JSON response
    return jsonify({
        'email': email_address,
        'unsubscribe': unsubscribe_request
    })

# Run the Flask application on port 5000
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)