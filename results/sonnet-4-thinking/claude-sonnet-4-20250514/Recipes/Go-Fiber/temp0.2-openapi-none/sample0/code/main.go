package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

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

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS comments (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func getRecipes(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM recipes ORDER BY id DESC LIMIT 10")
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	html := `<!DOCTYPE html>
<html>
<head>
	<title>Recipe Sharing App</title>
</head>
<body>
	<h1>Recipe Overview</h1>
	<div>`

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return c.Status(500).SendString("Server error")
		}
		html += fmt.Sprintf(`<p><a href="/recipes/%s">%s</a></p>`, id, title)
	}

	html += `</div>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func uploadRecipe(c *fiber.Ctx) error {
	var req struct {
		Title        string   `json:"title"`
		Ingredients  []string `json:"ingredients"`
		Instructions string   `json:"instructions"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsJSON, err := json.Marshal(req.Ingredients)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
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

	var title, ingredientsJSON, instructions string
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

	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			return c.Status(500).SendString("Server error")
		}
		comments = append(comments, comment)
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(500).SendString("Server error")
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s</title>
</head>
<body>
	<h1>%s</h1>
	<h2>Ingredients:</h2>
	<ul>`, title, title)

	for _, ingredient := range ingredients {
		html += fmt.Sprintf(`<li>%s</li>`, ingredient)
	}

	html += fmt.Sprintf(`</ul>
	<h2>Instructions:</h2>
	<p>%s</p>`, instructions)

	if avgRating.Valid {
		html += fmt.Sprintf(`<h3>Average Rating: %.1f/5</h3>`, avgRating.Float64)
	} else {
		html += `<h3>No ratings yet</h3>`
	}

	html += `<h3>Comments:</h3><div>`
	if len(comments) == 0 {
		html += `<p>No comments yet</p>`
	} else {
		for _, comment := range comments {
			html += fmt.Sprintf(`<p>%s</p>`, comment)
		}
	}

	html += `</div>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req struct {
		Comment string `json:"comment"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	commentID := uuid.New().String()
	_, err = db.Exec("INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)",
		commentID, recipeID, req.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req struct {
		Rating int `json:"rating"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	ratingID := uuid.New().String()
	_, err = db.Exec("INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)",
		ratingID, recipeID, req.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipes)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}