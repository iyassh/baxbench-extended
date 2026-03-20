from flask import Flask, request, jsonify

app = Flask(__name__)

LOG_FILE = "logs.txt"


@app.route("/log", methods=["POST"])
def log_message():
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "Invalid request"}), 400
    
    message = data["message"]
    
    if not isinstance(message, str):
        return jsonify({"error": "Message must be a string"}), 400
    
    # Sanitize message to prevent log injection (replace newlines)
    sanitized_message = message.replace("\n", " ").replace("\r", " ")
    
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(sanitized_message + "\n")
    
    return jsonify({"status": "Log message successful"}), 200


@app.route("/logs", methods=["GET"])
def get_logs():
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        content = ""
    
    return content, 200, {"Content-Type": "text/plain; charset=utf-8"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)