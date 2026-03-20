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
	Comments     []Comment `json:"comments,omitempty"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type UploadRecipeRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type AddCommentRequest struct {
	Comment string `json:"comment"`
}

type AddRatingRequest struct {
	Rating int `json:"rating"`
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS recipes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			ingredients TEXT NOT NULL,
			instructions TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS comments (
			id TEXT PRIMARY KEY,
			recipe_id TEXT NOT NULL,
			comment TEXT NOT NULL,
			FOREIGN KEY (recipe_id) REFERENCES recipes(id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ratings (
			id TEXT PRIMARY KEY,
			recipe_id TEXT NOT NULL,
			rating INTEGER NOT NULL,
			FOREIGN KEY (recipe_id) REFERENCES recipes(id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id
		ORDER BY avg_rating DESC, r.id DESC
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString("<html><head><title>Recipe Overview</title></head><body>")
	html.WriteString("<h1>Recipes</h1>")
	html.WriteString("<h2>Recent and Top-Rated Recipes</h2>")
	html.WriteString("<ul>")

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			continue
		}

		ratingStr := "No ratings"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("Rating: %.1f", avgRating.Float64)
		}

		html.WriteString(fmt.Sprintf("<li><a href='/recipes/%s'>%s</a> - %s</li>", id, title, ratingStr))
	}

	html.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var req UploadRecipeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).SendString("Invalid input")
	}

	id := uuid.New().String()
	ingredientsJSON, _ := json.Marshal(req.Ingredients)

	_, err := db.Exec(
		"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, string(ingredientsJSON), req.Instructions,
	)
	if err != nil {
		return c.Status(500).SendString("Server error")
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
	err := db.QueryRow(
		"SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
		recipeID,
	).Scan(&title, &ingredientsJSON, &instructions)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	var ingredients []string
	_ = json.Unmarshal([]byte(ingredientsJSON), &ingredients)

	commentRows, err := db.Query(
		"SELECT comment FROM comments WHERE recipe_id = ?",
		recipeID,
	)
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

	var avgRating sql.NullFloat64
	_ = db.QueryRow(
		"SELECT AVG(rating) FROM ratings WHERE recipe_id = ?",
		recipeID,
	).Scan(&avgRating)

	var html strings.Builder
	html.WriteString("<html><head><title>" + title + "</title></head><body>")
	html.WriteString("<h1>" + title + "</h1>")

	html.WriteString("<h2>Ingredients</h2><ul>")
	for _, ing := range ingredients {
		html.WriteString("<li>" + ing + "</li>")
	}
	html.WriteString("</ul>")

	html.WriteString("<h2>Instructions</h2>")
	html.WriteString("<p>" + instructions + "</p>")

	html.WriteString("<h2>Rating</h2>")
	if avgRating.Valid {
		html.WriteString(fmt.Sprintf("<p>Average Rating: %.1f / 5</p>", avgRating.Float64))
	} else {
		html.WriteString("<p>No ratings yet</p>")
	}

	html.WriteString("<h2>Comments</h2>")
	if len(comments) > 0 {
		html.WriteString("<ul>")
		for _, comment := range comments {
			html.WriteString("<li>" + comment + "</li>")
		}
		html.WriteString("</ul>")
	} else {
		html.WriteString("<p>No comments yet</p>")
	}

	html.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	if !exists {
		return c.Status(404).SendString("Recipe not found")
	}

	var req AddCommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.Comment == "" {
		return c.Status(400).SendString("Invalid input")
	}

	commentID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)",
		commentID, recipeID, req.Comment,
	)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	return c.SendStatus(201)
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	if !exists {
		return c.Status(404).SendString("Recipe not found")
	}

	var req AddRatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).SendString("Invalid input")
	}

	ratingID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)",
		ratingID, recipeID, req.Rating,
	)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	return c.SendStatus(201)
}