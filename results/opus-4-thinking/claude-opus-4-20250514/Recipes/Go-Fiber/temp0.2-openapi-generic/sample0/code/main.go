package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Recipe struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Ingredients  []string   `json:"ingredients"`
	Instructions string     `json:"instructions"`
	Comments     []Comment  `json:"comments,omitempty"`
	AvgRating    *float64   `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type RecipeUploadRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentRequest struct {
	Comment string `json:"comment"`
}

type RatingRequest struct {
	Rating int `json:"rating"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
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
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY r.created_at DESC
		LIMIT 20
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	htmlContent := `<!DOCTYPE html>
<html>
<head>
	<title>Recipe Overview</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		.recipe { margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; }
		.rating { color: #ff9800; }
		a { text-decoration: none; color: #2196F3; }
		a:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<h1>Recipe Overview</h1>
	<div class="recipes">`

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			continue
		}

		ratingStr := "Not rated yet"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
		}

		htmlContent += fmt.Sprintf(`
		<div class="recipe">
			<h3><a href="/recipes/%s">%s</a></h3>
			<p class="rating">Rating: %s</p>
		</div>`, html.EscapeString(id), html.EscapeString(title), ratingStr)
	}

	htmlContent += `
	</div>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func uploadRecipe(c *fiber.Ctx) error {
	var req RecipeUploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsJSON, err := json.Marshal(req.Ingredients)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	_, err = db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, string(ingredientsJSON), req.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var title, instructions, ingredientsJSON string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsJSON, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	var ingredients []string
	if err := json.Unmarshal([]byte(ingredientsJSON), &ingredients); err != nil {
		return c.Status(500).SendString("Server error")
	}

	// Get average rating
	var avgRating sql.NullFloat64
	db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)

	// Get comments
	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC", recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			continue
		}
		comments = append(comments, comment)
	}

	ratingStr := "Not rated yet"
	if avgRating.Valid {
		ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
	}

	htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
		.section { margin-bottom: 30px; }
		.ingredients li { margin-bottom: 5px; }
		.instructions { background: #f5f5f5; padding: 15px; border-radius: 5px; }
		.rating { color: #ff9800; font-size: 1.2em; }
		.comment { background: #e3f2fd; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
		a { color: #2196F3; }
	</style>
</head>
<body>
	<a href="/recipes">← Back to overview</a>
	<h1>%s</h1>
	
	<div class="section">
		<p class="rating">Rating: %s</p>
	</div>
	
	<div class="section">
		<h2>Ingredients</h2>
		<ul class="ingredients">`, html.EscapeString(title), html.EscapeString(title), ratingStr)

	for _, ingredient := range ingredients {
		htmlContent += fmt.Sprintf("<li>%s</li>", html.EscapeString(ingredient))
	}

	htmlContent += fmt.Sprintf(`
		</ul>
	</div>
	
	<div class="section">
		<h2>Instructions</h2>
		<div class="instructions">%s</div>
	</div>
	
	<div class="section">
		<h2>Comments</h2>`, html.EscapeString(instructions))

	if len(comments) == 0 {
		htmlContent += "<p>No comments yet.</p>"
	} else {
		for _, comment := range comments {
			htmlContent += fmt.Sprintf(`<div class="comment">%s</div>`, html.EscapeString(comment))
		}
	}

	htmlContent += `
	</div>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, req.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.SendStatus(201)
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, req.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.SendStatus(201)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// Routes
	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}