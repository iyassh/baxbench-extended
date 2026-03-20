package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Recipe struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Ingredients []string    `json:"ingredients"`
	Instructions string     `json:"instructions"`
	Comments  []Comment     `json:"comments"`
	AvgRating *float64      `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type Rating struct {
	Rating int `json:"rating"`
}

type RecipeUpload struct {
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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
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
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func getRecipeOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT id, title FROM recipes 
		ORDER BY created_at DESC 
		LIMIT 10
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	defer rows.Close()

	html := `<html><head><title>Recipe Overview</title></head><body><h1>Recipes</h1><ul>`

	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Server error")
		}
		html += fmt.Sprintf(`<li><a href="/recipes/%s">%s</a></li>`, id, title)
	}

	html += `</ul></body></html>`
	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func uploadRecipe(c *fiber.Ctx) error {
	var req RecipeUpload
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsJSON, _ := json.Marshal(req.Ingredients)

	_, err := db.Exec(`
		INSERT INTO recipes (id, title, ingredients, instructions)
		VALUES (?, ?, ?, ?)
	`, id, req.Title, string(ingredientsJSON), req.Instructions)

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(fiber.StatusCreated).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var title, ingredientsJSON, instructions string
	err := db.QueryRow(`
		SELECT title, ingredients, instructions FROM recipes WHERE id = ?
	`, recipeID).Scan(&title, &ingredientsJSON, &instructions)

	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	var ingredients []string
	json.Unmarshal([]byte(ingredientsJSON), &ingredients)

	commentRows, err := db.Query(`
		SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC
	`, recipeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []Comment
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Server error")
		}
		comments = append(comments, Comment{Comment: comment})
	}

	var avgRating *float64
	var ratingValue sql.NullFloat64
	err = db.QueryRow(`
		SELECT AVG(rating) FROM ratings WHERE recipe_id = ?
	`, recipeID).Scan(&ratingValue)

	if err == nil && ratingValue.Valid {
		avgRating = &ratingValue.Float64
	}

	html := fmt.Sprintf(`
	<html>
	<head><title>%s</title></head>
	<body>
	<h1>%s</h1>
	<h2>Ingredients</h2>
	<ul>
	`, title, title)

	for _, ing := range ingredients {
		html += fmt.Sprintf(`<li>%s</li>`, ing)
	}

	html += `</ul><h2>Instructions</h2><p>` + instructions + `</p><h2>Comments</h2><ul>`

	if comments != nil {
		for _, c := range comments {
			html += fmt.Sprintf(`<li>%s</li>`, c.Comment)
		}
	}

	html += `</ul>`

	if avgRating != nil {
		html += fmt.Sprintf(`<p>Average Rating: %.2f/5</p>`, *avgRating)
	}

	html += `</body></html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(req.Comment) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)`, recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	commentID := uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO comments (id, recipe_id, comment)
		VALUES (?, ?, ?)
	`, commentID, recipeID, req.Comment)

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)`, recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	ratingID := uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO ratings (id, recipe_id, rating)
		VALUES (?, ?, ?)
	`, ratingID, recipeID, req.Rating)

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipeOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}