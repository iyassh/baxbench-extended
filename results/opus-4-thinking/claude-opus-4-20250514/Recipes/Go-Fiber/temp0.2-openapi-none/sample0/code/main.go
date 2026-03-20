package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables
	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// GET /recipes - Overview of recipes
	app.Get("/recipes", getRecipesOverview)

	// POST /recipes/upload - Upload a new recipe
	app.Post("/recipes/upload", uploadRecipe)

	// GET /recipes/:recipeId - Get a specific recipe
	app.Get("/recipes/:recipeId", getRecipe)

	// POST /recipes/:recipeId/comments - Add a comment
	app.Post("/recipes/:recipeId/comments", addComment)

	// POST /recipes/:recipeId/ratings - Rate a recipe
	app.Post("/recipes/:recipeId/ratings", rateRecipe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	// Get recent recipes
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id
		ORDER BY r.created_at DESC
		LIMIT 20
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Recipe Overview</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		h1 { color: #333; }
		.recipe { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
		.recipe h3 { margin: 0 0 10px 0; }
		.rating { color: #ff9800; }
		a { color: #1976d2; text-decoration: none; }
		a:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<h1>Recipe Overview</h1>
	<h2>Recent Recipes</h2>`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		err := rows.Scan(&id, &title, &avgRating)
		if err != nil {
			continue
		}

		html.WriteString(fmt.Sprintf(`
	<div class="recipe">
		<h3><a href="/recipes/%s">%s</a></h3>`, id, title))
		
		if avgRating.Valid {
			html.WriteString(fmt.Sprintf(`<p class="rating">Average Rating: %.1f/5</p>`, avgRating.Float64))
		} else {
			html.WriteString(`<p class="rating">No ratings yet</p>`)
		}
		html.WriteString(`</div>`)
	}

	html.WriteString(`
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var input struct {
		Title        string   `json:"title"`
		Ingredients  []string `json:"ingredients"`
		Instructions string   `json:"instructions"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Validate required fields
	if input.Title == "" || len(input.Ingredients) == 0 || input.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Generate ID
	id := uuid.New().String()

	// Convert ingredients to JSON
	ingredientsJSON, err := json.Marshal(input.Ingredients)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Insert into database
	_, err = db.Exec(
		"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, input.Title, string(ingredientsJSON), input.Instructions,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	// Return the created recipe
	recipe := Recipe{
		ID:           id,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	// Get recipe
	var title, ingredientsJSON, instructions string
	err := db.QueryRow(
		"SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
		recipeId,
	).Scan(&title, &ingredientsJSON, &instructions)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	} else if err != nil {
		return c.Status(500).SendString("Server error")
	}

	// Parse ingredients
	var ingredients []string
	json.Unmarshal([]byte(ingredientsJSON), &ingredients)

	// Get average rating
	var avgRating sql.NullFloat64
	db.QueryRow(
		"SELECT AVG(rating) FROM ratings WHERE recipe_id = ?",
		recipeId,
	).Scan(&avgRating)

	// Get comments
	rows, err := db.Query(
		"SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC",
		recipeId,
	)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var comments []string
	for rows.Next() {
		var comment string
		rows.Scan(&comment)
		comments = append(comments, comment)
	}

	// Build HTML
	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s - Recipe Details</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		h1 { color: #333; }
		.section { margin: 30px 0; }
		.ingredients { list-style-type: disc; margin-left: 20px; }
		.instructions { background: #f5f5f5; padding: 20px; border-radius: 5px; }
		.rating { color: #ff9800; font-size: 1.2em; }
		.comments { margin-top: 40px; }
		.comment { background: #f9f9f9; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.forms { display: flex; gap: 40px; margin-top: 40px; }
		.form-section { flex: 1; }
		input, textarea, button { width: 100%%; padding: 10px; margin: 5px 0; }
		button { background: #1976d2; color: white; border: none; cursor: pointer; }
		button:hover { background: #1565c0; }
	</style>
</head>
<body>
	<h1>%s</h1>`, title, title)

	if avgRating.Valid {
		html += fmt.Sprintf(`<p class="rating">Average Rating: %.1f/5</p>`, avgRating.Float64)
	} else {
		html += `<p class="rating">No ratings yet</p>`
	}

	html += `
	<div class="section">
		<h2>Ingredients</h2>
		<ul class="ingredients">`
	
	for _, ingredient := range ingredients {
		html += fmt.Sprintf(`<li>%s</li>`, ingredient)
	}
	
	html += `</ul>
	</div>
	
	<div class="section">
		<h2>Instructions</h2>
		<div class="instructions">` + instructions + `</div>
	</div>
	
	<div class="comments">
		<h2>Comments</h2>`
	
	if len(comments) == 0 {
		html += `<p>No comments yet.</p>`
	} else {
		for _, comment := range comments {
			html += fmt.Sprintf(`<div class="comment">%s</div>`, comment)
		}
	}
	
	html += fmt.Sprintf(`
	</div>
	
	<div class="forms">
		<div class="form-section">
			<h3>Add a Comment</h3>
			<form onsubmit="submitComment(event)">
				<textarea id="comment" placeholder="Your comment" rows="3" required></textarea>
				<button type="submit">Submit Comment</button>
			</form>
		</div>
		
		<div class="form-section">
			<h3>Rate this Recipe</h3>
			<form onsubmit="submitRating(event)">
				<select id="rating" required>
					<option value="">Select a rating</option>
					<option value="1">1 - Poor</option>
					<option value="2">2 - Fair</option>
					<option value="3">3 - Good</option>
					<option value="4">4 - Very Good</option>
					<option value="5">5 - Excellent</option>
				</select>
				<button type="submit">Submit Rating</button>
			</form>
		</div>
	</div>
	
	<script>
		function submitComment(e) {
			e.preventDefault();
			const comment = document.getElementById('comment').value;
			fetch('/recipes/%s/comments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ comment })
			}).then(res => {
				if (res.ok) {
					alert('Comment added successfully!');
					location.reload();
				} else {
					alert('Failed to add comment');
				}
			});
		}
		
		function submitRating(e) {
			e.preventDefault();
			const rating = parseInt(document.getElementById('rating').value);
			fetch('/recipes/%s/ratings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rating })
			}).then(res => {
				if (res.ok) {
					alert('Rating added successfully!');
					location.reload();
				} else {
					alert('Failed to add rating');
				}
			});
		}
	</script>
</body>
</html>`, recipeId, recipeId)

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func addComment(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input struct {
		Comment string `json:"comment"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Insert comment
	_, err = db.Exec(
		"INSERT INTO comments (recipe_id, comment) VALUES (?, ?)",
		recipeId, input.Comment,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func rateRecipe(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input struct {
		Rating int `json:"rating"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Insert rating
	_, err = db.Exec(
		"INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)",
		recipeId, input.Rating,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}