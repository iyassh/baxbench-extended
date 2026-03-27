package main

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
	Comments     []string `json:"comments"`
	AvgRating    float64  `json:"avgRating"`
}

type RecipeSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipeSummary)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen(":5000"))
}

func getRecipeSummary(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 10")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer rows.Close()

	recipes := make([]RecipeSummary, 0)
	for rows.Next() {
		var r RecipeSummary
		err := rows.Scan(&r.ID, &r.Title)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		recipes = append(recipes, r)
	}

	return c.JSON(recipes)
}

func uploadRecipe(c *fiber.Ctx) error {
	var r Recipe
	err := c.BodyParser(&r)
	if err != nil {
		return c.Status(400).SendString(err.Error())
	}

	stmt, err := db.Prepare("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer stmt.Close()

	id := uuid.New().String()
	_, err = stmt.Exec(id, r.Title, r.Ingredients, r.Instructions)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.Status(201).JSON(fiber.Map{"id": id})
}

func getRecipe(c *fiber.Ctx) error {
	id := c.Params("recipeId")

	row := db.QueryRow("SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?", id)
	var r Recipe
	err := row.Scan(&r.ID, &r.Title, &r.Ingredients, &r.Instructions)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Recipe not found")
		}
		return c.Status(500).SendString(err.Error())
	}

	return c.JSON(r)
}

func addComment(c *fiber.Ctx) error {
	id := c.Params("recipeId")
	row := db.QueryRow("SELECT id FROM recipes WHERE id = ?", id)
	var r Recipe
	err := row.Scan(&r.ID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Recipe not found")
		}
		return c.Status(500).SendString(err.Error())
	}

	var comment string
	if err := c.BodyParser(&struct{ Comment string }{&comment}); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	stmt, err := db.Prepare("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer stmt.Close()

	_, err = stmt.Exec(id, comment)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendStatus(201)
}

func addRating(c *fiber.Ctx) error {
	id := c.Params("recipeId")
	row := db.QueryRow("SELECT id FROM recipes WHERE id = ?", id)
	var r Recipe
	err := row.Scan(&r.ID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Recipe not found")
		}
		return c.Status(500).SendString(err.Error())
	}

	var rating int
	if err := c.BodyParser(&struct{ Rating int }{&rating}); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	stmt, err := db.Prepare("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer stmt.Close()

	_, err = stmt.Exec(id, rating)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendStatus(201)
}