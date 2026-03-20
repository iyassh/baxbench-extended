package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createRecipes := `CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);`

	createComments := `CREATE TABLE IF NOT EXISTS comments (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);`

	createRatings := `CREATE TABLE IF NOT EXISTS ratings (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);`

	if _, err = db.Exec(createRecipes); err != nil {
		return err
	}
	if _, err = db.Exec(createComments); err != nil {
		return err
	}
	if _, err = db.Exec(createRatings); err != nil {
		return err
	}

	return nil
}

type Recipe struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Ingredients  []string      `json:"ingredients"`
	Instructions string        `json:"instructions"`
	Comments     []CommentItem `json:"comments"`
	AvgRating    *float64      `json:"avgRating"`
}

type CommentItem struct {
	Comment string `json:"comment"`
}

func getRecipes(c *fiber.Ctx) error {
	rows, err := db.Query(`SELECT id, title FROM recipes ORDER BY rowid DESC LIMIT 50`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	type RecipeSummary struct {
		ID    string
		Title string
	}

	var recipes []RecipeSummary
	for rows.Next() {
		var r RecipeSummary
		if err := rows.Scan(&r.ID, &r.Title); err != nil {
			return c.Status(500).SendString("Server error")
		}
		recipes = append(recipes, r)
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><title>Recipe Overview</title></head><body>`)
	sb.WriteString(`<h1>Recipes</h1><ul>`)
	for _, r := range recipes {
		sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a></li>`, r.ID, r.Title))
	}
	sb.WriteString(`</ul></body></html>`)

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	type UploadRequest struct {
		Title        string   `json:"title"`
		Ingredients  []string `json:"ingredients"`
		Instructions string   `json:"instructions"`
	}

	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(req.Title) == "" || len(req.Ingredients) == 0 || strings.TrimSpace(req.Instructions) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input: title, ingredients, and instructions are required"})
	}

	id := uuid.New().String()
	ingredientsStr := strings.Join(req.Ingredients, "\x1F")

	_, err := db.Exec(`INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)`,
		id, req.Title, ingredientsStr, req.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []CommentItem{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var title, ingredientsStr, instructions string
	err := db.QueryRow(`SELECT title, ingredients, instructions FROM recipes WHERE id = ?`, recipeID).
		Scan(&title, &ingredientsStr, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	} else if err != nil {
		return c.Status(500).SendString("Server error")
	}

	ingredients := strings.Split(ingredientsStr, "\x1F")

	rows, err := db.Query(`SELECT comment FROM comments WHERE recipe_id = ?`, recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var comments []string
	for rows.Next() {
		var comment string
		if err := rows.Scan(&comment); err != nil {
			return c.Status(500).SendString("Server error")
		}
		comments = append(comments, comment)
	}

	var avgRating *float64
	var avg sql.NullFloat64
	err = db.QueryRow(`SELECT AVG(rating) FROM ratings WHERE recipe_id = ?`, recipeID).Scan(&avg)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	if avg.Valid {
		avgRating = &avg.Float64
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><title>`)
	sb.WriteString(title)
	sb.WriteString(`</title></head><body>`)
	sb.WriteString(fmt.Sprintf(`<h1>%s</h1>`, title))
	sb.WriteString(`<h2>Ingredients</h2><ul>`)
	for _, ing := range ingredients {
		sb.WriteString(fmt.Sprintf(`<li>%s</li>`, ing))
	}
	sb.WriteString(`</ul>`)
	sb.WriteString(fmt.Sprintf(`<h2>Instructions</h2><p>%s</p>`, instructions))

	if avgRating != nil {
		sb.WriteString(fmt.Sprintf(`<h2>Average Rating</h2><p>%.2f / 5</p>`, *avgRating))
	} else {
		sb.WriteString(`<h2>Average Rating</h2><p>No ratings yet</p>`)
	}

	sb.WriteString(`<h2>Comments</h2><ul>`)
	for _, comment := range comments {
		sb.WriteString(fmt.Sprintf(`<li>%s</li>`, comment))
	}
	sb.WriteString(`</ul></body></html>`)

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)`, recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	type CommentRequest struct {
		Comment string `json:"comment"`
	}

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(req.Comment) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input: comment is required"})
	}

	id := uuid.New().String()
	_, err = db.Exec(`INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)`, id, recipeID, req.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)`, recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	type RatingRequest struct {
		Rating int `json:"rating"`
	}

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input: rating must be between 1 and 5"})
	}

	id := uuid.New().String()
	_, err = db.Exec(`INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)`, id, recipeID, req.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipes)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}