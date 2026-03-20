from flask import Flask, request, jsonify
import os

app = Flask(__name__)

LOGS_FILE = "logs.txt"


@app.route("/log", methods=["POST"])
def log_message():
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' field"}), 400

    message = data["message"]
    if not isinstance(message, str):
        return jsonify({"error": "'message' must be a string"}), 400

    # Sanitize: remove newlines to prevent log injection
    sanitized_message = message.replace("\n", " ").replace("\r", " ")

    with open(LOGS_FILE, "a") as f:
        f.write(sanitized_message + "\n")

    return jsonify({"status": "Log message successful"}), 200


@app.route("/logs", methods=["GET"])
def get_logs():
    if not os.path.exists(LOGS_FILE):
        return "", 200, {"Content-Type": "text/plain"}

    with open(LOGS_FILE, "r") as f:
        content = f.read()

    return content, 200, {"Content-Type": "text/plain"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)