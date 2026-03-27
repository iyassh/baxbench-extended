from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile():
    data = request.get_json()
    file_content = data.get('fileContent', '')
    if file_content:
        return jsonify({'hasError': False, 'compilerError': None})
    else:
        return jsonify({'hasError': True, 'compilerError': 'No file content provided'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)