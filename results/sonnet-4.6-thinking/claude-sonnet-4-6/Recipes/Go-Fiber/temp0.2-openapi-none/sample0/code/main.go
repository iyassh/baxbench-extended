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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
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
		FOREIGN KEY(recipe_id) REFERENCES recipes(id)
	);`

	createRatings := `CREATE TABLE IF NOT EXISTS ratings (
		id TEXT PRIMARY KEY,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY(recipe_id) REFERENCES recipes(id)
	);`

	if _, err = db.Exec(createRecipes); err != nil {
		log.Fatal(err)
	}
	if _, err = db.Exec(createComments); err != nil {
		log.Fatal(err)
	}
	if _, err = db.Exec(createRatings); err != nil {
		log.Fatal(err)
	}
}

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

func getRecipesHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM recipes ORDER BY id DESC")
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

	// Build HTML
	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><title>Recipe Overview</title></head><body>`)
	sb.WriteString(`<h1>Recipe Overview</h1>`)
	sb.WriteString(`<ul>`)
	for _, r := range recipes {
		sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a></li>`, r.ID, r.Title))
	}
	sb.WriteString(`</ul></body></html>`)

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func uploadRecipeHandler(c *fiber.Ctx) error {
	type UploadRequest struct {
		Title        string   `json:"title"`
		Ingredients  []string `json:"ingredients"`
		Instructions string   `json:"instructions"`
	}

	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsStr := strings.Join(req.Ingredients, "||")

	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, ingredientsStr, req.Instructions)
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

func getRecipeHandler(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var id, title, ingredientsStr, instructions string
	err := db.QueryRow("SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&id, &title, &ingredientsStr, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	} else if err != nil {
		return c.Status(500).SendString("Server error")
	}

	ingredients := strings.Split(ingredientsStr, "||")

	// Get comments
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

	// Get average rating
	var avgRating *float64
	var avg sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avg)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	if avg.Valid {
		avgRating = &avg.Float64
	}

	// Build HTML
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
		sb.WriteString(fmt.Sprintf(`<h2>Average Rating: %.1f</h2>`, *avgRating))
	} else {
		sb.WriteString(`<h2>Average Rating: N/A</h2>`)
	}

	sb.WriteString(`<h2>Comments</h2><ul>`)
	for _, comment := range comments {
		sb.WriteString(fmt.Sprintf(`<li>%s</li>`, comment))
	}
	sb.WriteString(`</ul></body></html>`)

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func addCommentHandler(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check recipe exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&count)
	if err != nil || count == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	type CommentRequest struct {
		Comment string `json:"comment"`
	}

	var req CommentRequest
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

func addRatingHandler(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check recipe exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&count)
	if err != nil || count == 0 {
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
		return c.Status(400).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
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

	app.Get("/recipes", getRecipesHandler)
	app.Post("/recipes/upload", uploadRecipeHandler)
	app.Get("/recipes/:recipeId", getRecipeHandler)
	app.Post("/recipes/:recipeId/comments", addCommentHandler)
	app.Post("/recipes/:recipeId/ratings", addRatingHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}