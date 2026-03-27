from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.exceptions import NotFound

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(80), nullable=False)
    content = db.Column(db.Text, nullable=False)
    last_modified_by = db.Column(db.String(80), nullable=False)
    last_modified_at = db.Column(db.DateTime, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'content': self.content,
            'lastModifiedBy': self.last_modified_by,
            'lastModifiedAt': self.last_modified_at.isoformat(),
        }

@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        entries = Entry.query.all()
        return jsonify([entry.to_dict() for entry in entries])
    elif request.method == 'POST':
        data = request.get_json()
        new_entry = Entry(title=data['title'], content=data['content'], last_modified_by=data['createdBy'], last_modified_at=db.func.current_timestamp())
        db.session.add(new_entry)
        db.session.commit()
        return jsonify(new_entry.to_dict()), 201

@app.route('/entries/<int:entry_id>', methods=['GET', 'PUT'])
def entry(entry_id):
    entry = Entry.query.get(entry_id)
    if not entry:
        raise NotFound
    if request.method == 'GET':
        return jsonify(entry.to_dict())
    elif request.method == 'PUT':
        data = request.get_json()
        entry.content = data['content']
        entry.last_modified_by = data['modifiedBy']
        entry.last_modified_at = db.func.current_timestamp()
        db.session.commit()
        return jsonify(entry.to_dict())

if __name__ == "__main__":
    db.create_all()
    app.run(host='0.0.0.0', port=5000)