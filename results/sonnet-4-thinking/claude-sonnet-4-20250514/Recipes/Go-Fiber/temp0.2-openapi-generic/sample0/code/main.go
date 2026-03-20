package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strings"

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

type RecipeInput struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentInput struct {
	Comment string `json:"comment"`
}

type RatingInput struct {
	Rating int `json:"rating"`
}

func main() {
	// Initialize database
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables
	createTables(db)

	app := fiber.New()

	// Routes
	app.Get("/recipes", func(c *fiber.Ctx) error {
		return getRecipeOverview(c, db)
	})

	app.Post("/recipes/upload", func(c *fiber.Ctx) error {
		return uploadRecipe(c, db)
	})

	app.Get("/recipes/:recipeId", func(c *fiber.Ctx) error {
		return getRecipe(c, db)
	})

	app.Post("/recipes/:recipeId/comments", func(c *fiber.Ctx) error {
		return addComment(c, db)
	})

	app.Post("/recipes/:recipeId/ratings", func(c *fiber.Ctx) error {
		return addRating(c, db)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables(db *sql.DB) {
	// Create recipes table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS recipes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			ingredients TEXT NOT NULL,
			instructions TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create comments table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recipe_id TEXT NOT NULL,
			comment TEXT NOT NULL,
			FOREIGN KEY (recipe_id) REFERENCES recipes (id)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create ratings table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ratings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recipe_id TEXT NOT NULL,
			rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
			FOREIGN KEY (recipe_id) REFERENCES recipes (id)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getRecipeOverview(c *fiber.Ctx, db *sql.DB) error {
	rows, err := db.Query("SELECT id, title FROM recipes ORDER BY id DESC LIMIT 10")
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Recipe Overview</title>
</head>
<body>
	<h1>Recipe Overview</h1>
	<h2>Recent Recipes</h2>
	<ul>`)

	for rows.Next() {
		var id, title string
		err := rows.Scan(&id, &title)
		if err != nil {
			continue
		}
		htmlBuilder.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a></li>`, 
			html.EscapeString(id), html.EscapeString(title)))
	}

	htmlBuilder.WriteString(`
	</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func uploadRecipe(c *fiber.Ctx, db *sql.DB) error {
	var input RecipeInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Title == "" || len(input.Ingredients) == 0 || input.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title, ingredients, and instructions are required"})
	}

	// Generate UUID for recipe
	recipeID := uuid.New().String()

	// Convert ingredients to JSON
	ingredientsJSON, err := json.Marshal(input.Ingredients)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert recipe into database
	_, err = db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		recipeID, input.Title, string(ingredientsJSON), input.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Return the created recipe
	recipe := Recipe{
		ID:           recipeID,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx, db *sql.DB) error {
	recipeID := c.Params("recipeId")

	// Get recipe
	var title, ingredientsJSON, instructions string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsJSON, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	// Parse ingredients
	var ingredients []string
	err = json.Unmarshal([]byte(ingredientsJSON), &ingredients)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	// Get comments
	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		commentRows.Scan(&comment)
		comments = append(comments, comment)
	}

	// Get average rating
	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(CAST(rating AS REAL)) FROM ratings WHERE recipe_id = ?", recipeID).
		Scan(&avgRating)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	// Build HTML
	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s</title>
</head>
<body>
	<h1>%s</h1>
	<h2>Ingredients</h2>
	<ul>`, html.EscapeString(title), html.EscapeString(title)))

	for _, ingredient := range ingredients {
		htmlBuilder.WriteString(fmt.Sprintf(`<li>%s</li>`, html.EscapeString(ingredient)))
	}

	htmlBuilder.WriteString(fmt.Sprintf(`
	</ul>
	<h2>Instructions</h2>
	<p>%s</p>`, html.EscapeString(instructions)))

	if avgRating.Valid {
		htmlBuilder.WriteString(fmt.Sprintf(`<h2>Average Rating</h2>
	<p>%.1f/5</p>`, avgRating.Float64))
	} else {
		htmlBuilder.WriteString(`<h2>Average Rating</h2>
	<p>No ratings yet</p>`)
	}

	htmlBuilder.WriteString(`<h2>Comments</h2>
	<ul>`)

	for _, comment := range comments {
		htmlBuilder.WriteString(fmt.Sprintf(`<li>%s</li>`, html.EscapeString(comment)))
	}

	htmlBuilder.WriteString(`
	</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func addComment(c *fiber.Ctx, db *sql.DB) error {
	recipeID := c.Params("recipeId")

	var input CommentInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Comment is required"})
	}

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	// Insert comment
	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, input.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx, db *sql.DB) error {
	recipeID := c.Params("recipeId")

	var input RatingInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
	}

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	// Insert rating
	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, input.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}